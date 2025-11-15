import { TypedEventEmitter } from "@libp2p/interface";
import { createDecoder, createEncoder } from "@waku/core";
import {
  AutoSharding,
  IDecodedMessage,
  IDecoder,
  IEncoder,
  IWaku
} from "@waku/interfaces";
import { MessageChannelEvent } from "@waku/sds";
import {
  createRoutingInfo,
  delay,
  MockWakuEvents,
  MockWakuNode
} from "@waku/utils";
import { utf8ToBytes } from "@waku/utils/bytes";
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

describe("Reliable Channel: Sync", () => {
  let mockWakuNode: IWaku;
  let encoder: IEncoder;
  let decoder: IDecoder<IDecodedMessage>;

  beforeEach(async () => {
    mockWakuNode = new MockWakuNode();
    encoder = createEncoder({
      contentTopic: TEST_CONTENT_TOPIC,
      routingInfo: TEST_ROUTING_INFO
    });
    decoder = createDecoder(TEST_CONTENT_TOPIC, TEST_ROUTING_INFO);
  });

  it("Sync message is sent within sync frequency", async () => {
    const syncMinIntervalMs = 100;
    const reliableChannel = await ReliableChannel.create(
      mockWakuNode,
      "MyChannel",
      "alice",
      encoder,
      decoder,
      {
        syncMinIntervalMs
      }
    );

    // Send a message to have a history
    const sentMsgId = reliableChannel.send(utf8ToBytes("some message"));
    let messageSent = false;
    reliableChannel.addEventListener("message-sent", (event) => {
      if (event.detail === sentMsgId) {
        messageSent = true;
      }
    });

    while (!messageSent) {
      await delay(10);
    }

    let syncMessageSent = false;
    reliableChannel.messageChannel.addEventListener(
      MessageChannelEvent.OutSyncSent,
      (_event) => {
        syncMessageSent = true;
      }
    );

    await delay(syncMinIntervalMs);

    expect(syncMessageSent).to.be.true;
  });

  it("Sync message are not sent excessively within sync frequency", async () => {
    const syncMinIntervalMs = 100;
    const reliableChannel = await ReliableChannel.create(
      mockWakuNode,
      "MyChannel",
      "alice",
      encoder,
      decoder,
      {
        syncMinIntervalMs
      }
    );

    let syncMessageSentCount = 0;
    reliableChannel.messageChannel.addEventListener(
      MessageChannelEvent.OutSyncSent,
      (_event) => {
        syncMessageSentCount++;
      }
    );

    await delay(syncMinIntervalMs);

    // There is randomness to this, but it should not be excessive
    expect(syncMessageSentCount).to.be.lessThan(3);
  });

  it("Sync message is not sent if another sync message was just received", async function () {
    this.timeout(5000);

    const commonEventEmitter = new TypedEventEmitter<MockWakuEvents>();
    const mockWakuNodeAlice = new MockWakuNode(commonEventEmitter);
    const mockWakuNodeBob = new MockWakuNode(commonEventEmitter);

    const syncMinIntervalMs = 1000;

    const reliableChannelAlice = await ReliableChannel.create(
      mockWakuNodeAlice,
      "MyChannel",
      "alice",
      encoder,
      decoder,
      {
        syncMinIntervalMs: 0, // does not send sync messages automatically
        processTaskMinElapseMs: 10
      }
    );
    const reliableChannelBob = await ReliableChannel.create(
      mockWakuNodeBob,
      "MyChannel",
      "bob",
      encoder,
      decoder,
      {
        syncMinIntervalMs,
        processTaskMinElapseMs: 10
      }
    );
    (reliableChannelBob as any).random = () => {
      return 1;
    }; // will wait a full second

    // Send a message to have a history
    const sentMsgId = reliableChannelAlice.send(utf8ToBytes("some message"));
    let messageSent = false;
    reliableChannelAlice.addEventListener("message-sent", (event) => {
      if (event.detail === sentMsgId) {
        messageSent = true;
      }
    });

    while (!messageSent) {
      await delay(50);
    }

    let syncMessageSent = false;
    reliableChannelBob.messageChannel.addEventListener(
      MessageChannelEvent.OutSyncSent,
      (_event) => {
        syncMessageSent = true;
      }
    );

    while (!syncMessageSent) {
      // Bob will send a sync message as soon as it started, we are waiting for this one
      await delay(100);
    }
    // Let's reset the tracker
    syncMessageSent = false;
    // We should be faster than Bob as Bob will "randomly" wait a full second
    await reliableChannelAlice["sendSyncMessage"]();

    // Bob should be waiting a full second before sending a message after Alice
    await delay(900);

    // Now, let's wait Bob to send the sync message
    await delay(200);
    expect(syncMessageSent).to.be.true;
  });

  it("Sync message is not sent if another non-ephemeral message was just received", async function () {
    this.timeout(5000);

    const commonEventEmitter = new TypedEventEmitter<MockWakuEvents>();
    const mockWakuNodeAlice = new MockWakuNode(commonEventEmitter);
    const mockWakuNodeBob = new MockWakuNode(commonEventEmitter);

    const syncMinIntervalMs = 1000;

    const reliableChannelAlice = await ReliableChannel.create(
      mockWakuNodeAlice,
      "MyChannel",
      "alice",
      encoder,
      decoder,
      {
        syncMinIntervalMs: 0, // does not send sync messages automatically
        processTaskMinElapseMs: 10
      }
    );
    const reliableChannelBob = await ReliableChannel.create(
      mockWakuNodeBob,
      "MyChannel",
      "bob",
      encoder,
      decoder,
      {
        syncMinIntervalMs,
        processTaskMinElapseMs: 10
      }
    );
    (reliableChannelBob as any).random = () => {
      return 1;
    }; // will wait a full second

    // Send a message to have a history
    const sentMsgId = reliableChannelAlice.send(utf8ToBytes("some message"));
    let messageSent = false;
    reliableChannelAlice.addEventListener("message-sent", (event) => {
      if (event.detail === sentMsgId) {
        messageSent = true;
      }
    });

    while (!messageSent) {
      await delay(50);
    }

    let syncMessageSent = false;
    reliableChannelBob.messageChannel.addEventListener(
      MessageChannelEvent.OutSyncSent,
      (_event) => {
        syncMessageSent = true;
      }
    );

    while (!syncMessageSent) {
      // Bob will send a sync message as soon as it started, we are waiting for this one
      await delay(100);
    }
    // Let's reset the tracker
    syncMessageSent = false;
    // We should be faster than Bob as Bob will "randomly" wait a full second
    reliableChannelAlice.send(utf8ToBytes("some message"));

    // Bob should be waiting a full second before sending a message after Alice
    await delay(900);

    // Now, let's wait Bob to send the sync message
    await delay(200);
    expect(syncMessageSent).to.be.true;
  });

  it("Sync message is not sent if another sync message was just sent", async function () {
    this.timeout(5000);
    const syncMinIntervalMs = 1000;

    const reliableChannel = await ReliableChannel.create(
      mockWakuNode,
      "MyChannel",
      "alice",
      encoder,
      decoder,
      { syncMinIntervalMs }
    );
    (reliableChannel as any).random = () => {
      return 1;
    }; // will wait a full second

    // Send a message to have a history
    const sentMsgId = reliableChannel.send(utf8ToBytes("some message"));
    let messageSent = false;
    reliableChannel.addEventListener("message-sent", (event) => {
      if (event.detail === sentMsgId) {
        messageSent = true;
      }
    });

    while (!messageSent) {
      await delay(50);
    }

    let syncMessageSent = false;
    reliableChannel.messageChannel.addEventListener(
      MessageChannelEvent.OutSyncSent,
      (_event) => {
        syncMessageSent = true;
      }
    );

    while (!syncMessageSent) {
      // Will send a sync message as soon as it started, we are waiting for this one
      await delay(100);
    }
    // Let's reset the tracker
    syncMessageSent = false;
    // We should be faster than automated sync as it will "randomly" wait a full second
    await reliableChannel["sendSyncMessage"]();

    // should be waiting a full second before sending a message after Alice
    await delay(900);

    // Now, let's wait to send the automated sync message
    await delay(200);
    expect(syncMessageSent).to.be.true;
  });

  it("Sync message is not sent if another non-ephemeral message was just sent", async function () {
    this.timeout(5000);
    const syncMinIntervalMs = 1000;

    const reliableChannel = await ReliableChannel.create(
      mockWakuNode,
      "MyChannel",
      "alice",
      encoder,
      decoder,
      { syncMinIntervalMs }
    );
    (reliableChannel as any).random = () => {
      return 1;
    }; // will wait a full second

    // Send a message to have a history
    const sentMsgId = reliableChannel.send(utf8ToBytes("some message"));
    let messageSent = false;
    reliableChannel.addEventListener("message-sent", (event) => {
      if (event.detail === sentMsgId) {
        messageSent = true;
      }
    });

    while (!messageSent) {
      await delay(50);
    }

    let syncMessageSent = false;
    reliableChannel.messageChannel.addEventListener(
      MessageChannelEvent.OutSyncSent,
      (_event) => {
        syncMessageSent = true;
      }
    );

    while (!syncMessageSent) {
      // Will send a sync message as soon as it started, we are waiting for this one
      await delay(100);
    }
    // Let's reset the tracker
    syncMessageSent = false;
    // We should be faster than automated sync as it will "randomly" wait a full second
    reliableChannel.send(utf8ToBytes("non-ephemeral message"));

    // should be waiting a full second before sending a message after Alice
    await delay(900);

    // Now, let's wait to send the automated sync message
    await delay(200);
    expect(syncMessageSent).to.be.true;
  });

  it("Own sync message does not acknowledge own messages", async () => {
    const syncMinIntervalMs = 100;
    const reliableChannel = await ReliableChannel.create(
      mockWakuNode,
      "MyChannel",
      "alice",
      encoder,
      decoder,
      {
        syncMinIntervalMs
      }
    );

    const msg = utf8ToBytes("some message");
    const msgId = ReliableChannel.getMessageId(msg);

    let messageAcknowledged = false;
    reliableChannel.messageChannel.addEventListener(
      MessageChannelEvent.OutMessageAcknowledged,
      (event) => {
        if (event.detail === msgId) messageAcknowledged = true;
      }
    );

    reliableChannel.send(msg);

    await delay(syncMinIntervalMs * 2);

    // There is randomness to this, but it should not be excessive
    expect(messageAcknowledged).to.be.false;
  });
});
