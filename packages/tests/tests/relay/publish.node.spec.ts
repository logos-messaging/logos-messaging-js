import { createEncoder } from "@waku/core";
import { IRateLimitProof, ProtocolError, RelayNode } from "@waku/interfaces";
import { createRoutingInfo } from "@waku/utils";
import { utf8ToBytes } from "@waku/utils/bytes";
import { expect } from "chai";

import {
  afterEachCustom,
  beforeEachCustom,
  delay,
  generateRandomUint8Array,
  MessageCollector,
  tearDownNodes,
  TEST_STRING
} from "../../src/index.js";

import {
  messageText,
  runJSNodes,
  TestClusterId,
  TestContentTopic,
  TestDecoder,
  TestEncoder,
  TestExpectOptions,
  TestRoutingInfo,
  waitForAllRemotePeers
} from "./utils.js";

describe("Waku Relay, Publish", function () {
  this.timeout(15000);
  let waku1: RelayNode;
  let waku2: RelayNode;
  let messageCollector: MessageCollector;

  beforeEachCustom(this, async () => {
    [waku1, waku2] = await runJSNodes();
    messageCollector = new MessageCollector();
    await waku2.relay.subscribeWithUnsubscribe(
      [TestDecoder],
      messageCollector.callback
    );
  });

  afterEachCustom(this, async () => {
    await tearDownNodes([], [waku1, waku2]);
  });

  TEST_STRING.forEach((testItem) => {
    it(`Check publish message containing ${testItem.description}`, async function () {
      const pushResponse = await waku1.relay.send(TestEncoder, {
        payload: utf8ToBytes(testItem.value)
      });
      expect(pushResponse.successes.length).to.eq(1);
      expect(pushResponse.successes[0].toString()).to.eq(
        waku2.libp2p.peerId.toString()
      );
      expect(await messageCollector.waitForMessages(1)).to.eq(true);
      messageCollector.verifyReceivedMessage(0, {
        ...TestExpectOptions,
        expectedMessageText: testItem.value
      });
    });
  });

  [
    new Date("1995-12-17T03:24:00"),
    new Date(Date.now() - 3600000 * 24 * 356),
    new Date(Date.now() - 3600000),
    new Date(Date.now() + 3600000)
  ].forEach((testItem) => {
    it(`Publish message with custom timestamp: ${testItem}`, async function () {
      const pushResponse = await waku1.relay.send(TestEncoder, {
        payload: utf8ToBytes(messageText),
        timestamp: testItem
      });

      expect(pushResponse.successes.length).to.eq(1);
      expect(pushResponse.successes[0].toString()).to.eq(
        waku2.libp2p.peerId.toString()
      );

      expect(await messageCollector.waitForMessages(1)).to.eq(true);

      messageCollector.verifyReceivedMessage(0, {
        ...TestExpectOptions,
        expectedMessageText: messageText,
        expectedTimestamp: testItem.valueOf()
      });
    });
  });

  it("Fails to publish duplicate message", async function () {
    await waku1.relay.send(TestEncoder, { payload: utf8ToBytes("m1") });
    try {
      await waku1.relay.send(TestEncoder, { payload: utf8ToBytes("m1") });
      await waku1.relay.send(TestEncoder, { payload: utf8ToBytes("m1") });
      expect.fail("Expected an error but didn't get one");
    } catch (error) {
      expect((error as Error).message).to.include("PublishError.Duplicate");
    }
  });

  it("Fails to publish message with empty text", async function () {
    await waku1.relay.send(TestEncoder, { payload: utf8ToBytes("") });
    await delay(400);
    expect(await messageCollector.waitForMessages(1)).to.eq(false);
  });

  it("Fails to publish message with wrong pubsubtopic", async function () {
    const wrong_encoder = createEncoder({
      contentTopic: TestContentTopic,
      routingInfo: createRoutingInfo(
        { clusterId: TestClusterId },
        { shardId: 32 }
      )
    });
    const pushResponse = await waku1.relay.send(wrong_encoder, {
      payload: utf8ToBytes("")
    });
    expect(pushResponse.failures?.[0].error).to.eq(
      ProtocolError.TOPIC_NOT_CONFIGURED
    );
    await delay(400);
    expect(await messageCollector.waitForMessages(1)).to.eq(false);
  });

  [1024 ** 2 + 65536, 2 * 1024 ** 2].forEach((testItem) => {
    it("Fails to publish message with size larger than 1 MB", async function () {
      const pushResponse = await waku1.relay.send(TestEncoder, {
        payload: generateRandomUint8Array(testItem)
      });
      expect(pushResponse.successes.length).to.eq(0);
      expect(pushResponse.failures?.map((failure) => failure.error)).to.include(
        ProtocolError.SIZE_TOO_BIG
      );
      await delay(400);
      expect(await messageCollector.waitForMessages(1)).to.eq(false);
    });
  });

  // Will be skipped until https://github.com/logos-messaging/logos-messaging-js/issues/1464 si done
  it.skip("Check publish message after service node is restarted", async function () {
    await waku1.relay.send(TestEncoder, {
      payload: utf8ToBytes("m1")
    });

    // Restart js-waku node
    await waku1.stop();
    expect(waku1.isStarted()).to.eq(false);
    await waku1.start();
    expect(waku1.isStarted()).to.eq(true);
    await waku1.dial(waku2.libp2p.peerId);

    // Redo the connection and create a new subscription
    await waitForAllRemotePeers(waku1, waku2);
    const pushResponse = await waku1.relay.send(TestEncoder, {
      payload: utf8ToBytes("m2")
    });
    expect(pushResponse.successes.length).to.eq(1);
    expect(pushResponse.successes[0].toString()).to.eq(
      waku2.libp2p.peerId.toString()
    );
    expect(await messageCollector.waitForMessages(2)).to.eq(true);
  });

  // Will be skipped until https://github.com/logos-messaging/logos-messaging-js/issues/1464 si done
  it.skip("Check publish message after client node is restarted", async function () {
    await waku1.relay.send(TestEncoder, {
      payload: utf8ToBytes("m1")
    });

    // Restart js-waku node
    await waku2.stop();
    expect(waku2.isStarted()).to.eq(false);
    await waku2.start();
    expect(waku2.isStarted()).to.eq(true);
    await waku1.dial(waku2.libp2p.peerId);

    // Redo the connection and create a new subscription
    await waitForAllRemotePeers(waku1, waku2);
    const pushResponse = await waku1.relay.send(TestEncoder, {
      payload: utf8ToBytes("m2")
    });
    expect(pushResponse.successes.length).to.eq(1);
    expect(pushResponse.successes[0].toString()).to.eq(
      waku2.libp2p.peerId.toString()
    );
    expect(await messageCollector.waitForMessages(2)).to.eq(true);
  });

  it("Publish message with large meta", async function () {
    const customTestEncoder = createEncoder({
      contentTopic: TestContentTopic,
      routingInfo: TestRoutingInfo,
      metaSetter: () => new Uint8Array(10 ** 6)
    });

    const pushResponse = await waku1.relay.send(customTestEncoder, {
      payload: utf8ToBytes(messageText)
    });
    expect(pushResponse.successes.length).to.eq(1);
    expect(pushResponse.successes[0].toString()).to.eq(
      waku2.libp2p.peerId.toString()
    );
    expect(await messageCollector.waitForMessages(1)).to.eq(true);
  });

  it("Publish message with rate limit", async function () {
    const rateLimitProof: IRateLimitProof = {
      proof: utf8ToBytes("proofData"),
      merkleRoot: utf8ToBytes("merkleRootData"),
      epoch: utf8ToBytes("epochData"),
      shareX: utf8ToBytes("shareXData"),
      shareY: utf8ToBytes("shareYData"),
      nullifier: utf8ToBytes("nullifierData"),
      rlnIdentifier: utf8ToBytes("rlnIdentifierData")
    };

    const pushResponse = await waku1.relay.send(TestEncoder, {
      payload: utf8ToBytes(messageText),
      rateLimitProof: rateLimitProof
    });
    expect(pushResponse.successes.length).to.eq(1);

    expect(await messageCollector.waitForMessages(1)).to.eq(true);
    messageCollector.verifyReceivedMessage(0, {
      ...TestExpectOptions,
      expectedMessageText: messageText
    });
  });
});
