import { TypedEventEmitter } from "@libp2p/interface";
import {
  AutoSharding,
  IDecodedMessage,
  IDecoder,
  IEncoder,
  type IMessage,
  ISendOptions,
  IWaku,
  LightPushError,
  LightPushSDKResult
} from "@waku/interfaces";
import { generatePrivateKey, getPublicKey } from "@waku/message-encryption";
import {
  createDecoder as createEciesDecoder,
  createEncoder as createEciesEncoder
} from "@waku/message-encryption/ecies";
import {
  createRoutingInfo,
  delay,
  MockWakuEvents,
  MockWakuNode
} from "@waku/utils";
import { bytesToUtf8, utf8ToBytes } from "@waku/utils/bytes";
import { expect } from "chai";
import { beforeEach, describe } from "mocha";

import { ReliableChannel } from "./index.js";

const TEST_CONTENT_TOPIC = "/my-tests/0/topic-name/proto";
const TEST_NETWORK_CONFIG: AutoSharding = {
  clusterId: 0,
  numShardsInCluster: 1
};
const TEST_ROUTING_INFO = createRoutingInfo(TEST_NETWORK_CONFIG, {
  contentTopic: TEST_CONTENT_TOPIC
});

describe("Reliable Channel: Encryption", () => {
  let mockWakuNode: IWaku;
  let encoder: IEncoder;
  let decoder: IDecoder<IDecodedMessage>;

  beforeEach(async () => {
    mockWakuNode = new MockWakuNode();
    const privateKey = generatePrivateKey();
    const publicKey = getPublicKey(privateKey);
    encoder = createEciesEncoder({
      contentTopic: TEST_CONTENT_TOPIC,
      routingInfo: TEST_ROUTING_INFO,
      publicKey
    });
    decoder = createEciesDecoder(
      TEST_CONTENT_TOPIC,
      TEST_ROUTING_INFO,
      privateKey
    );
  });

  it("Outgoing message is emitted as sending", async () => {
    const reliableChannel = await ReliableChannel.create(
      mockWakuNode,
      "MyChannel",
      "alice",
      encoder,
      decoder
    );

    const message = utf8ToBytes("message in channel");

    // Setting up message tracking
    const messageId = ReliableChannel.getMessageId(message);
    let messageSending = false;
    reliableChannel.addEventListener("sending-message", (event) => {
      if (event.detail === messageId) {
        messageSending = true;
      }
    });

    reliableChannel.send(message);
    while (!messageSending) {
      await delay(50);
    }

    expect(messageSending).to.be.true;
  });

  it("Outgoing message is emitted as sent", async () => {
    const reliableChannel = await ReliableChannel.create(
      mockWakuNode,
      "MyChannel",
      "alice",
      encoder,
      decoder
    );

    const message = utf8ToBytes("message in channel");

    // Setting up message tracking
    const messageId = ReliableChannel.getMessageId(message);
    let messageSent = false;
    reliableChannel.addEventListener("message-sent", (event) => {
      if (event.detail === messageId) {
        messageSent = true;
      }
    });

    reliableChannel.send(message);
    while (!messageSent) {
      await delay(50);
    }

    expect(messageSent).to.be.true;
  });

  it("Encoder error raises irrecoverable error", async () => {
    mockWakuNode.lightPush!.send = (
      _encoder: IEncoder,
      _message: IMessage,
      _sendOptions?: ISendOptions
    ): Promise<LightPushSDKResult> => {
      return Promise.resolve({
        failures: [{ error: LightPushError.EMPTY_PAYLOAD }],
        successes: []
      });
    };

    const reliableChannel = await ReliableChannel.create(
      mockWakuNode,
      "MyChannel",
      "alice",
      encoder,
      decoder
    );

    const message = utf8ToBytes("payload doesnt matter");

    // Setting up message tracking
    const messageId = ReliableChannel.getMessageId(message);
    let irrecoverableError = false;
    reliableChannel.addEventListener(
      "sending-message-irrecoverable-error",
      (event) => {
        if (event.detail.messageId === messageId) {
          irrecoverableError = true;
        }
      }
    );

    encoder.contentTopic = "...";
    reliableChannel.send(message);
    while (!irrecoverableError) {
      await delay(50);
    }

    expect(irrecoverableError).to.be.true;
  });

  it("Outgoing message is not emitted as acknowledged from own outgoing messages", async () => {
    const reliableChannel = await ReliableChannel.create(
      mockWakuNode,
      "MyChannel",
      "alice",
      encoder,
      decoder
    );

    const message = utf8ToBytes("first message in channel");

    // Setting up message tracking
    const messageId = ReliableChannel.getMessageId(message);
    let messageAcknowledged = false;
    reliableChannel.addEventListener("message-acknowledged", (event) => {
      if (event.detail === messageId) {
        messageAcknowledged = true;
      }
    });

    reliableChannel.send(message);

    // Sending a second message from the same node should not acknowledge the first one
    reliableChannel.send(utf8ToBytes("second message in channel"));

    // Wait a bit to be sure no event is emitted
    await delay(200);

    expect(messageAcknowledged).to.be.false;
  });

  // TODO: https://github.com/logos-messaging/logos-messaging-js/issues/2648
  it.skip("Outgoing message is possibly acknowledged", async () => {
    const commonEventEmitter = new TypedEventEmitter<MockWakuEvents>();
    const mockWakuNodeAlice = new MockWakuNode(commonEventEmitter);
    const mockWakuNodeBob = new MockWakuNode(commonEventEmitter);

    const reliableChannelAlice = await ReliableChannel.create(
      mockWakuNodeAlice,
      "MyChannel",
      "alice",
      encoder,
      decoder
    );
    const reliableChannelBob = await ReliableChannel.create(
      mockWakuNodeBob,
      "MyChannel",
      "bob",
      encoder,
      decoder,
      // Bob only includes one message in causal history
      { causalHistorySize: 1 }
    );

    const messages = ["first", "second", "third"].map((m) => {
      return utf8ToBytes(m);
    });

    // Alice sets up message tracking for first message
    const firstMessageId = ReliableChannel.getMessageId(messages[0]);
    let firstMessagePossiblyAcknowledged = false;
    reliableChannelAlice.addEventListener(
      "message-possibly-acknowledged",
      (event) => {
        if (event.detail.messageId === firstMessageId) {
          firstMessagePossiblyAcknowledged = true;
        }
      }
    );

    let bobMessageReceived = 0;
    reliableChannelAlice.addEventListener("message-received", () => {
      bobMessageReceived++;
    });

    for (const m of messages) {
      reliableChannelAlice.send(m);
    }

    // Wait for Bob to receive all messages to ensure filter is updated
    while (bobMessageReceived < 3) {
      await delay(50);
    }

    // Bobs sends a message now, it should include first one in bloom filter
    reliableChannelBob.send(utf8ToBytes("message back"));
    while (!firstMessagePossiblyAcknowledged) {
      await delay(50);
    }

    expect(firstMessagePossiblyAcknowledged).to.be.true;
  });

  it("Outgoing message is acknowledged", async () => {
    const commonEventEmitter = new TypedEventEmitter<MockWakuEvents>();
    const mockWakuNodeAlice = new MockWakuNode(commonEventEmitter);
    const mockWakuNodeBob = new MockWakuNode(commonEventEmitter);

    const reliableChannelAlice = await ReliableChannel.create(
      mockWakuNodeAlice,
      "MyChannel",
      "alice",
      encoder,
      decoder
    );
    const reliableChannelBob = await ReliableChannel.create(
      mockWakuNodeBob,
      "MyChannel",
      "bob",
      encoder,
      decoder
    );

    const message = utf8ToBytes("first message in channel");

    // Alice sets up message tracking
    const messageId = ReliableChannel.getMessageId(message);
    let messageAcknowledged = false;
    reliableChannelAlice.addEventListener("message-acknowledged", (event) => {
      if (event.detail === messageId) {
        messageAcknowledged = true;
      }
    });

    let bobReceivedMessage = false;
    reliableChannelBob.addEventListener("message-received", () => {
      bobReceivedMessage = true;
    });

    reliableChannelAlice.send(message);

    // Wait for Bob to receive the message
    while (!bobReceivedMessage) {
      await delay(50);
    }

    // Bobs sends a message now, it should include first one in causal history
    reliableChannelBob.send(utf8ToBytes("second message in channel"));
    while (!messageAcknowledged) {
      await delay(50);
    }

    expect(messageAcknowledged).to.be.true;
  });

  it("Incoming message is emitted as received", async () => {
    const reliableChannel = await ReliableChannel.create(
      mockWakuNode,
      "MyChannel",
      "alice",
      encoder,
      decoder
    );

    let receivedMessage: IDecodedMessage;
    reliableChannel.addEventListener("message-received", (event) => {
      receivedMessage = event.detail;
    });

    const message = utf8ToBytes("message in channel");

    reliableChannel.send(message);
    while (!receivedMessage!) {
      await delay(50);
    }

    expect(bytesToUtf8(receivedMessage!.payload)).to.eq(bytesToUtf8(message));
  });
});
