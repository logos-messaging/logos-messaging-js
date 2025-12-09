import { createDecoder, createEncoder } from "@waku/core";
import { RelayNode } from "@waku/interfaces";
import { createRelayNode } from "@waku/relay";
import { createRoutingInfo } from "@waku/utils";
import { utf8ToBytes } from "@waku/utils/bytes";
import { expect } from "chai";

import {
  afterEachCustom,
  beforeEachCustom,
  generateTestData,
  MessageCollector,
  NOISE_KEY_1,
  tearDownNodes,
  TEST_STRING
} from "../../src/index.js";

import {
  messageText,
  runJSNodes,
  TestDecoder,
  TestEncoder,
  TestExpectOptions,
  TestNetworkConfig,
  TestRoutingInfo,
  waitForAllRemotePeers
} from "./utils.js";

describe("Waku Relay, Subscribe", function () {
  this.timeout(40000);
  let waku1: RelayNode;
  let waku2: RelayNode;
  let messageCollector: MessageCollector;

  beforeEachCustom(this, async () => {
    [waku1, waku2] = await runJSNodes();
    messageCollector = new MessageCollector(this.ctx.nwaku);
  });

  afterEachCustom(this, async () => {
    await tearDownNodes([], [waku1, waku2]);
  });

  it("Mutual subscription", async function () {
    await waitForAllRemotePeers(waku1, waku2);
    const subscribers1 = waku1.libp2p.services
      .pubsub!.getSubscribers(TestRoutingInfo.pubsubTopic)
      .map((p) => p.toString());
    const subscribers2 = waku2.libp2p.services
      .pubsub!.getSubscribers(TestRoutingInfo.pubsubTopic)
      .map((p) => p.toString());

    expect(subscribers1).to.contain(waku2.libp2p.peerId.toString());
    expect(subscribers2).to.contain(waku1.libp2p.peerId.toString());
  });

  it("Register correct protocols", async function () {
    const protocols = waku1.libp2p.getProtocols();

    expect(protocols).to.contain("/vac/waku/relay/2.0.0");
    expect(protocols.findIndex((value) => value.match(/sub/))).to.eq(-1);
  });

  it("Publish without waiting for remote peer", async function () {
    try {
      const waku = await createRelayNode({
        staticNoiseKey: NOISE_KEY_1,
        networkConfig: TestNetworkConfig,
        routingInfos: [TestRoutingInfo]
      });
      await waku.start();

      await waku.relay.send(TestEncoder, {
        payload: utf8ToBytes(messageText)
      });

      throw new Error("Publish was successful but was expected to fail");
    } catch (err) {
      if (
        !(err instanceof Error) ||
        !err.message.includes("PublishError.NoPeersSubscribedToTopic")
      ) {
        throw err;
      }
    }
  });

  it("Subscribe and publish message", async function () {
    await waku2.relay.subscribeWithUnsubscribe(
      [TestDecoder],
      messageCollector.callback
    );
    await waku1.relay.send(TestEncoder, { payload: utf8ToBytes(messageText) });
    expect(await messageCollector.waitForMessages(1)).to.eq(true);
    messageCollector.verifyReceivedMessage(0, {
      ...TestExpectOptions,
      expectedMessageText: messageText
    });
  });

  it("Subscribe and publish 10000 messages on the same topic", async function () {
    const messageCount = 10000;
    await waku2.relay.subscribeWithUnsubscribe(
      [TestDecoder],
      messageCollector.callback
    );
    // Send a unique message on each topic.
    for (let i = 0; i < messageCount; i++) {
      await waku1.relay.send(TestEncoder, {
        payload: utf8ToBytes(`M${i + 1}`)
      });
    }

    // Verify that each message was received on the corresponding topic.
    expect(
      await messageCollector.waitForMessages(messageCount, {
        exact: true
      })
    ).to.eq(true);

    for (let i = 0; i < messageCount; i++) {
      messageCollector.verifyReceivedMessage(i, {
        ...TestExpectOptions,
        expectedMessageText: `M${i + 1}`,
        checkTimestamp: false
      });
    }
  });

  it("Subscribe and publish messages on 2 different content topics", async function () {
    const secondContentTopic = "/test/0/waku-relay-2/utf8";
    const secondRoutingInfo = createRoutingInfo(TestNetworkConfig, {
      contentTopic: secondContentTopic
    });
    const secondEncoder = createEncoder({
      contentTopic: secondContentTopic,
      routingInfo: secondRoutingInfo
    });
    const secondDecoder = createDecoder(secondContentTopic, secondRoutingInfo);

    await waku2.relay.subscribeWithUnsubscribe(
      [TestDecoder],
      messageCollector.callback
    );
    await waku2.relay.subscribeWithUnsubscribe(
      [secondDecoder],
      messageCollector.callback
    );
    await waku1.relay.send(TestEncoder, { payload: utf8ToBytes("M1") });
    await waku1.relay.send(secondEncoder, { payload: utf8ToBytes("M2") });
    expect(
      await messageCollector.waitForMessages(2, {
        exact: true
      })
    ).to.eq(true);
    messageCollector.verifyReceivedMessage(0, {
      ...TestExpectOptions,
      expectedMessageText: "M1"
    });
    messageCollector.verifyReceivedMessage(1, {
      ...TestExpectOptions,
      expectedContentTopic: secondEncoder.contentTopic,
      expectedMessageText: "M2"
    });
  });

  it("Subscribe one by one to 100 topics and publish messages", async function () {
    const topicCount = 100;
    const td = generateTestData(topicCount, TestNetworkConfig);

    // Subscribe to topics one by one
    for (let i = 0; i < topicCount; i++) {
      await waku2.relay.subscribeWithUnsubscribe(
        [td.decoders[i]],
        messageCollector.callback
      );
    }

    // Send a unique message on each topic.
    for (let i = 0; i < topicCount; i++) {
      await waku1.relay.send(td.encoders[i], {
        payload: utf8ToBytes(`Message for Topic ${i + 1}`)
      });
    }

    // Verify that each message was received on the corresponding topic.
    expect(
      await messageCollector.waitForMessages(topicCount, {
        exact: true
      })
    ).to.eq(true);
    td.contentTopics.forEach((topic, index) => {
      messageCollector.verifyReceivedMessage(index, {
        ...TestExpectOptions,
        expectedContentTopic: topic,
        expectedMessageText: `Message for Topic ${index + 1}`
      });
    });
  });

  it("Subscribe at once to 10000 topics and publish messages", async function () {
    const topicCount = 10000;
    const td = generateTestData(topicCount, TestNetworkConfig);

    // Subscribe to all topics at once
    await waku2.relay.subscribeWithUnsubscribe(
      td.decoders,
      messageCollector.callback
    );

    // Send a unique message on each topic.
    for (let i = 0; i < topicCount; i++) {
      await waku1.relay.send(td.encoders[i], {
        payload: utf8ToBytes(`Message for Topic ${i + 1}`)
      });
    }

    // Verify that each message was received on the corresponding topic.
    expect(
      await messageCollector.waitForMessages(topicCount, {
        exact: true
      })
    ).to.eq(true);
    td.contentTopics.forEach((topic, index) => {
      messageCollector.verifyReceivedMessage(index, {
        ...TestExpectOptions,
        expectedContentTopic: topic,
        expectedMessageText: `Message for Topic ${index + 1}`,
        checkTimestamp: false
      });
    });
  });

  // Will be skipped until https://github.com/logos-messaging/logos-messaging-js/issues/1678 is fixed
  it.skip("Refresh subscription", async function () {
    await waku2.relay.subscribeWithUnsubscribe(
      [TestDecoder],
      messageCollector.callback
    );
    await waku2.relay.subscribeWithUnsubscribe(
      [TestDecoder],
      messageCollector.callback
    );

    await waku1.relay.send(TestEncoder, { payload: utf8ToBytes("M1") });

    expect(
      await messageCollector.waitForMessages(1, {
        exact: true
      })
    ).to.eq(true);
  });

  // Will be skipped until https://github.com/logos-messaging/logos-messaging-js/issues/1678 is fixed
  it.skip("Overlapping topic subscription", async function () {
    // Define two sets of test data with overlapping topics.
    const topicCount1 = 2;
    const td1 = generateTestData(topicCount1, TestNetworkConfig);
    const topicCount2 = 4;
    const td2 = generateTestData(topicCount2, TestNetworkConfig);

    // Subscribe to the first set of topics.
    await waku2.relay.subscribeWithUnsubscribe(
      td1.decoders,
      messageCollector.callback
    );
    // Subscribe to the second set of topics which has overlapping topics with the first set.
    await waku2.relay.subscribeWithUnsubscribe(
      td2.decoders,
      messageCollector.callback
    );

    // Send messages to the first set of topics.
    for (let i = 0; i < topicCount1; i++) {
      const messageText = `Message for Topic ${i + 1}`;
      await waku1.relay.send(td1.encoders[i], {
        payload: utf8ToBytes(messageText)
      });
    }

    // Send messages to the second set of topics.
    for (let i = 0; i < topicCount2; i++) {
      const messageText = `Message for Topic ${i + 3}`;
      await waku1.relay.send(td2.encoders[i], {
        payload: utf8ToBytes(messageText)
      });
    }

    // Check if all messages were received.
    // Since there are overlapping topics, there should be 6 messages in total (2 from the first set + 4 from the second set).
    expect(
      await messageCollector.waitForMessages(6, {
        exact: true
      })
    ).to.eq(true);
  });

  TEST_STRING.forEach((testItem) => {
    it(`Subscribe to topic containing ${testItem.description} and publish message`, async function () {
      const newContentTopic = `/test/0/${testItem.value}/null`;

      try {
        const newRoutingInfo = createRoutingInfo(TestNetworkConfig, {
          contentTopic: newContentTopic
        });

        const newEncoder = createEncoder({
          contentTopic: newContentTopic,
          routingInfo: newRoutingInfo
        });
        const newDecoder = createDecoder(newContentTopic, newRoutingInfo);

        await waku2.relay.subscribeWithUnsubscribe(
          [newDecoder],
          messageCollector.callback
        );
        await waku1.relay.send(newEncoder, {
          payload: utf8ToBytes(messageText)
        });

        expect(await messageCollector.waitForMessages(1)).to.eq(true);
        messageCollector.verifyReceivedMessage(0, {
          ...TestExpectOptions,
          expectedMessageText: messageText,
          expectedContentTopic: newContentTopic
        });
      } catch (err: unknown) {
        if (testItem.invalidContentTopic) {
          const e = err as Error;
          expect(e.message).to.contain("Invalid generation field");
        }
      }
    });
  });
});
