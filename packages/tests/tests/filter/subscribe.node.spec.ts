import { createDecoder, createEncoder } from "@waku/core";
import { IDecodedMessage, IDecoder, LightNode } from "@waku/interfaces";
import {
  ecies,
  generatePrivateKey,
  generateSymmetricKey,
  getPublicKey,
  symmetric
} from "@waku/message-encryption";
import { utf8ToBytes } from "@waku/sdk";
import { createRoutingInfo } from "@waku/utils";
import { expect } from "chai";

import {
  afterEachCustom,
  beforeEachCustom,
  delay,
  generateTestData,
  runMultipleNodes,
  ServiceNodesFleet,
  teardownNodesWithRedundancy,
  TEST_STRING,
  waitForConnections
} from "../../src/index.js";

import {
  messagePayload,
  messageText,
  TestClusterId,
  TestContentTopic,
  TestDecoder,
  TestEncoder,
  TestNetworkConfig,
  TestRoutingInfo,
  TestShardIndex
} from "./utils.js";

const runTests = (strictCheckNodes: boolean): void => {
  describe(`Waku Filter: Subscribe: Multiple Service Nodes: Strict Check mode: ${strictCheckNodes}`, function () {
    this.timeout(100000);
    let waku: LightNode;
    let serviceNodes: ServiceNodesFleet;

    beforeEachCustom(this, async () => {
      [serviceNodes, waku] = await runMultipleNodes(
        this.ctx,
        TestRoutingInfo,
        undefined,
        strictCheckNodes
      );
    });

    afterEachCustom(this, async () => {
      await teardownNodesWithRedundancy(serviceNodes, waku);
    });

    it("Subscribe and receive messages via lightPush", async function () {
      expect(waku.libp2p.getConnections()).has.length(2);

      await waku.filter.subscribe(
        TestDecoder,
        serviceNodes.messageCollector.callback
      );

      await waku.lightPush.send(TestEncoder, messagePayload);

      expect(await serviceNodes.messageCollector.waitForMessages(1)).to.eq(
        true
      );
      serviceNodes.messageCollector.verifyReceivedMessage(0, {
        expectedMessageText: messageText,
        expectedContentTopic: TestContentTopic
      });

      await serviceNodes.confirmMessageLength(1);
    });

    it("Subscribe and receive ecies encrypted messages via lightPush", async function () {
      const privateKey = generatePrivateKey();
      const publicKey = getPublicKey(privateKey);
      const encoder = ecies.createEncoder({
        contentTopic: TestContentTopic,
        publicKey,
        routingInfo: TestRoutingInfo
      });
      const decoder = ecies.createDecoder(
        TestContentTopic,
        TestRoutingInfo,
        privateKey
      );

      await waku.filter.subscribe(
        decoder,
        serviceNodes.messageCollector.callback
      );

      await waku.lightPush.send(encoder, messagePayload);

      expect(await serviceNodes.messageCollector.waitForMessages(1)).to.eq(
        true
      );
      serviceNodes.messageCollector.verifyReceivedMessage(0, {
        expectedMessageText: messageText,
        expectedContentTopic: TestContentTopic,
        expectedVersion: 1,
        expectedPubsubTopic: TestRoutingInfo.pubsubTopic
      });

      await serviceNodes.confirmMessageLength(2);
    });

    it("Subscribe and receive symmetrically encrypted messages via lightPush", async function () {
      const symKey = generateSymmetricKey();
      const encoder = symmetric.createEncoder({
        contentTopic: TestContentTopic,
        symKey,
        routingInfo: TestRoutingInfo
      });
      const decoder = symmetric.createDecoder(
        TestContentTopic,
        TestRoutingInfo,
        symKey
      );

      await waku.filter.subscribe(
        decoder,
        serviceNodes.messageCollector.callback
      );

      await waku.lightPush.send(encoder, messagePayload);

      expect(await serviceNodes.messageCollector.waitForMessages(1)).to.eq(
        true
      );
      serviceNodes.messageCollector.verifyReceivedMessage(0, {
        expectedMessageText: messageText,
        expectedContentTopic: TestContentTopic,
        expectedVersion: 1,
        expectedPubsubTopic: TestRoutingInfo.pubsubTopic
      });

      await serviceNodes.confirmMessageLength(2);
    });

    it("Subscribe and receive messages via waku relay post", async function () {
      await waku.filter.subscribe(
        TestDecoder,
        serviceNodes.messageCollector.callback
      );

      await delay(400);

      // Send a test message using the relay post method.
      const relayMessage = ServiceNodesFleet.toMessageRpcQuery({
        contentTopic: TestContentTopic,
        payload: utf8ToBytes(messageText)
      });
      await serviceNodes.sendRelayMessage(relayMessage, TestRoutingInfo);

      expect(await serviceNodes.messageCollector.waitForMessages(1)).to.eq(
        true
      );
      serviceNodes.messageCollector.verifyReceivedMessage(0, {
        expectedMessageText: messageText,
        expectedContentTopic: TestContentTopic,
        expectedPubsubTopic: TestRoutingInfo.pubsubTopic
      });

      await serviceNodes.confirmMessageLength(1);
    });

    it("Subscribe and receive 2 messages on the same topic", async function () {
      await waku.filter.subscribe(
        TestDecoder,
        serviceNodes.messageCollector.callback
      );

      await waku.lightPush.send(TestEncoder, messagePayload);

      expect(await serviceNodes.messageCollector.waitForMessages(1)).to.eq(
        true
      );
      serviceNodes.messageCollector.verifyReceivedMessage(0, {
        expectedMessageText: messageText,
        expectedContentTopic: TestContentTopic
      });

      // Send another message on the same topic.
      const newMessageText = "Filtering still works!";
      await waku.lightPush.send(TestEncoder, {
        payload: utf8ToBytes(newMessageText)
      });

      // Verify that the second message was successfully received.
      expect(await serviceNodes.messageCollector.waitForMessages(2)).to.eq(
        true
      );
      serviceNodes.messageCollector.verifyReceivedMessage(1, {
        expectedMessageText: newMessageText,
        expectedContentTopic: TestContentTopic
      });

      await serviceNodes.confirmMessageLength(2);
    });

    it("Subscribe and receive messages on 2 different content topics", async function () {
      // Subscribe to the first content topic and send a message.
      await waku.filter.subscribe(
        TestDecoder,
        serviceNodes.messageCollector.callback
      );
      await waku.lightPush.send(TestEncoder, messagePayload);
      expect(await serviceNodes.messageCollector.waitForMessages(1)).to.eq(
        true
      );
      serviceNodes.messageCollector.verifyReceivedMessage(0, {
        expectedMessageText: messageText,
        expectedContentTopic: TestContentTopic,
        expectedPubsubTopic: TestRoutingInfo.pubsubTopic
      });

      // Modify subscription to include a new content topic and send a message.
      const newMessageText = "Filtering still works!";
      const newContentTopic = "/test/2/waku-filter/default";
      const newRoutingInfo = createRoutingInfo(TestNetworkConfig, {
        contentTopic: newContentTopic
      });
      const newEncoder = createEncoder({
        contentTopic: newContentTopic,
        routingInfo: newRoutingInfo
      });
      const newDecoder = createDecoder(newContentTopic, newRoutingInfo);
      await waku.filter.subscribe(
        newDecoder,
        serviceNodes.messageCollector.callback
      );
      await waku.lightPush.send(newEncoder, {
        payload: utf8ToBytes(newMessageText)
      });
      expect(await serviceNodes.messageCollector.waitForMessages(2)).to.eq(
        true
      );
      serviceNodes.messageCollector.verifyReceivedMessage(1, {
        expectedContentTopic: newContentTopic,
        expectedMessageText: newMessageText,
        expectedPubsubTopic: TestRoutingInfo.pubsubTopic
      });

      // Send another message on the initial content topic to verify it still works.
      const thirdMessageText = "Filtering still works on first subscription!";
      const thirdMessagePayload = { payload: utf8ToBytes(thirdMessageText) };
      await waku.lightPush.send(TestEncoder, thirdMessagePayload);
      expect(await serviceNodes.messageCollector.waitForMessages(3)).to.eq(
        true
      );
      serviceNodes.messageCollector.verifyReceivedMessage(2, {
        expectedMessageText: thirdMessageText,
        expectedContentTopic: TestContentTopic,
        expectedPubsubTopic: TestRoutingInfo.pubsubTopic
      });

      // This relies on nwaku not emptying the relay cache
      // We received the 3 messages already, what else are checking?
      // await serviceNodes.confirmMessageLength(3);
    });

    it("Subscribe and receives messages on 20 topics", async function () {
      const topicCount = 20;
      const td = generateTestData(topicCount, TestNetworkConfig);

      // Subscribe to all 20 topics.
      for (let i = 0; i < topicCount; i++) {
        await waku.filter.subscribe(
          td.decoders[i],
          serviceNodes.messageCollector.callback
        );
      }

      // Send a unique message on each topic.
      for (let i = 0; i < topicCount; i++) {
        await waku.lightPush.send(td.encoders[i], {
          payload: utf8ToBytes(`Message for Topic ${i + 1}`)
        });
      }

      // Verify that each message was received on the corresponding topic.
      expect(await serviceNodes.messageCollector.waitForMessages(20)).to.eq(
        true
      );
      td.contentTopics.forEach((topic, index) => {
        serviceNodes.messageCollector.verifyReceivedMessage(index, {
          expectedContentTopic: topic,
          expectedMessageText: `Message for Topic ${index + 1}`,
          expectedPubsubTopic: TestRoutingInfo.pubsubTopic
        });
      });
    });

    // skipped as it fails in CI but not locally https://github.com/logos-messaging/logos-messaging-js/issues/2438
    it.skip("Subscribe to 30 topics in separate streams (30 streams for Filter is limit) at once and receives messages", async function () {
      this.timeout(100_000);
      const topicCount = 30;
      const td = generateTestData(topicCount, TestNetworkConfig);

      for (let i = 0; i < topicCount; i++) {
        await waku.filter.subscribe(
          td.decoders[i],
          serviceNodes.messageCollector.callback
        );
      }

      // Send a unique message on each topic.
      for (let i = 0; i < topicCount; i++) {
        await waku.lightPush.send(td.encoders[i], {
          payload: utf8ToBytes(`Message for Topic ${i + 1}`)
        });
      }

      // Verify that each message was received on the corresponding topic.
      expect(
        await serviceNodes.messageCollector.waitForMessages(topicCount)
      ).to.eq(true);
      td.contentTopics.forEach((topic, index) => {
        serviceNodes.messageCollector.verifyReceivedMessage(index, {
          expectedContentTopic: topic,
          expectedMessageText: `Message for Topic ${index + 1}`,
          expectedPubsubTopic: TestRoutingInfo.pubsubTopic
        });
      });
    });

    it("Subscribe to 100 topics (new limit) at once and receives messages", async function () {
      this.timeout(100_000);
      const topicCount = 100;
      const td = generateTestData(topicCount, TestNetworkConfig);

      await waku.filter.subscribe(
        td.decoders,
        serviceNodes.messageCollector.callback
      );

      // Send a unique message on each topic.
      for (let i = 0; i < topicCount; i++) {
        await waku.lightPush.send(td.encoders[i], {
          payload: utf8ToBytes(`Message for Topic ${i + 1}`)
        });
      }

      // Verify that each message was received on the corresponding topic.
      expect(
        await serviceNodes.messageCollector.waitForMessages(topicCount)
      ).to.eq(true);
      td.contentTopics.forEach((topic, index) => {
        serviceNodes.messageCollector.verifyReceivedMessage(index, {
          expectedContentTopic: topic,
          expectedMessageText: `Message for Topic ${index + 1}`,
          expectedPubsubTopic: TestRoutingInfo.pubsubTopic
        });
      });
    });

    it("Error when try to subscribe to more than 101 topics (new limit)", async function () {
      const topicCount = 101;
      const td = generateTestData(topicCount, TestNetworkConfig);

      try {
        await waku.filter.subscribe(
          td.decoders,
          serviceNodes.messageCollector.callback
        );
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes(
            `exceeds maximum content topics: ${topicCount - 1}`
          )
        ) {
          return;
        } else {
          throw err;
        }
      }
    });

    it("Overlapping topic subscription", async function () {
      // Define two sets of test data with overlapping topics.
      const topicCount1 = 2;
      const td1 = generateTestData(topicCount1, TestNetworkConfig);

      const topicCount2 = 4;
      const td2 = generateTestData(topicCount2, TestNetworkConfig);

      await waku.filter.subscribe(
        td1.decoders,
        serviceNodes.messageCollector.callback
      );

      // Subscribe to the second set of topics which has overlapping topics with the first set.
      await waku.filter.subscribe(
        td2.decoders,
        serviceNodes.messageCollector.callback
      );

      // Send messages to the first set of topics.
      for (let i = 0; i < topicCount1; i++) {
        const messageText = `Topic Set 1: Message Number: ${i + 1}`;
        await waku.lightPush.send(td1.encoders[i], {
          payload: utf8ToBytes(messageText)
        });
      }

      // Send messages to the second set of topics.
      for (let i = 0; i < topicCount2; i++) {
        const messageText = `Topic Set 2: Message Number: ${i + 1}`;
        await waku.lightPush.send(td2.encoders[i], {
          payload: utf8ToBytes(messageText)
        });
      }

      // Since there are overlapping topics, there should be 10 messages in total because overlaping decoders handle them
      expect(
        await serviceNodes.messageCollector.waitForMessages(10, { exact: true })
      ).to.eq(true);
    });

    it("Refresh subscription", async function () {
      await waku.filter.subscribe(
        TestDecoder,
        serviceNodes.messageCollector.callback
      );
      await waku.lightPush.send(TestEncoder, { payload: utf8ToBytes("M1") });

      // Resubscribe (refresh) to the same topic and send another message.
      await waku.filter.subscribe(
        TestDecoder,
        serviceNodes.messageCollector.callback
      );
      await waku.lightPush.send(TestEncoder, { payload: utf8ToBytes("M2") });

      // Confirm both messages were received.
      expect(
        await serviceNodes.messageCollector.waitForMessages(2, { exact: true })
      ).to.eq(true);
      serviceNodes.messageCollector.verifyReceivedMessage(0, {
        expectedMessageText: "M1",
        expectedContentTopic: TestContentTopic,
        expectedPubsubTopic: TestRoutingInfo.pubsubTopic
      });
      serviceNodes.messageCollector.verifyReceivedMessage(1, {
        expectedMessageText: "M2",
        expectedContentTopic: TestContentTopic,
        expectedPubsubTopic: TestRoutingInfo.pubsubTopic
      });
    });

    TEST_STRING.forEach((testItem) => {
      it(`Subscribe to topic containing ${testItem.description} and receive message`, async function () {
        const newContentTopic = `/test/0/${testItem.description}/test`;
        const newEncoder = waku.createEncoder({
          contentTopic: newContentTopic,
          shardId: TestShardIndex
        });
        const newDecoder = waku.createDecoder({
          contentTopic: newContentTopic,
          shardId: TestShardIndex
        });

        await waku.filter.subscribe(
          newDecoder as IDecoder<IDecodedMessage>,
          serviceNodes.messageCollector.callback
        );
        await waku.lightPush.send(newEncoder, messagePayload);

        expect(await serviceNodes.messageCollector.waitForMessages(1)).to.eq(
          true
        );
        serviceNodes.messageCollector.verifyReceivedMessage(0, {
          expectedMessageText: messageText,
          expectedContentTopic: newContentTopic,
          expectedPubsubTopic: TestRoutingInfo.pubsubTopic
        });
      });
    });

    it("Add multiple subscription objects on single nwaku node", async function () {
      await waku.filter.subscribe(
        TestDecoder,
        serviceNodes.messageCollector.callback
      );
      await waku.lightPush.send(TestEncoder, { payload: utf8ToBytes("M1") });

      const newContentTopic = "/test/2/waku-filter/default";
      const newRoutingInfo = createRoutingInfo(TestNetworkConfig, {
        contentTopic: newContentTopic
      });

      const newEncoder = createEncoder({
        contentTopic: newContentTopic,
        routingInfo: newRoutingInfo
      });
      const newDecoder = createDecoder(newContentTopic, newRoutingInfo);
      await waku.filter.subscribe(
        newDecoder,
        serviceNodes.messageCollector.callback
      );

      await waku.lightPush.send(newEncoder, { payload: utf8ToBytes("M2") });

      // Check if both messages were received
      expect(await serviceNodes.messageCollector.waitForMessages(2)).to.eq(
        true
      );
      serviceNodes.messageCollector.verifyReceivedMessage(0, {
        expectedMessageText: "M1",
        expectedContentTopic: TestContentTopic,
        expectedPubsubTopic: TestRoutingInfo.pubsubTopic
      });
      serviceNodes.messageCollector.verifyReceivedMessage(1, {
        expectedContentTopic: newContentTopic,
        expectedMessageText: "M2",
        expectedPubsubTopic: newRoutingInfo.pubsubTopic
      });
    });

    it("Renews subscription after lossing a connection", async function () {
      // setup check
      expect(waku.libp2p.getConnections()).has.length(2);

      await waku.filter.subscribe(
        TestDecoder,
        serviceNodes.messageCollector.callback
      );

      await waku.lightPush.send(TestEncoder, messagePayload);

      expect(await serviceNodes.messageCollector.waitForMessages(1)).to.eq(
        true
      );
      serviceNodes.messageCollector.verifyReceivedMessage(0, {
        expectedMessageText: messageText,
        expectedContentTopic: TestContentTopic
      });

      await serviceNodes.confirmMessageLength(1);

      // check renew logic
      const nwakuPeers = await Promise.all(
        serviceNodes.nodes.map((v) => v.getMultiaddrWithId())
      );
      await Promise.all(nwakuPeers.map((v) => waku.libp2p.hangUp(v)));

      expect(waku.libp2p.getConnections().length).eq(0);

      await Promise.all(nwakuPeers.map((v) => waku.libp2p.dial(v)));
      await waitForConnections(nwakuPeers.length, waku);

      const testText = "second try";
      await waku.lightPush.send(TestEncoder, {
        payload: utf8ToBytes(testText)
      });

      expect(await serviceNodes.messageCollector.waitForMessages(2)).to.eq(
        true
      );
      serviceNodes.messageCollector.verifyReceivedMessage(1, {
        expectedMessageText: testText,
        expectedContentTopic: TestContentTopic
      });
    });
  });

  describe("Filter subscribe test with static sharding", function () {
    this.timeout(100000);
    let waku: LightNode;
    let serviceNodes: ServiceNodesFleet;
    const networkConfig = { clusterId: TestClusterId };
    const routingInfo = createRoutingInfo(networkConfig, { shardId: 3 });

    beforeEachCustom(this, async () => {
      [serviceNodes, waku] = await runMultipleNodes(
        this.ctx,
        routingInfo,
        {},
        strictCheckNodes
      );
    });

    afterEachCustom(this, async () => {
      await teardownNodesWithRedundancy(serviceNodes, waku);
    });
  });
};

[true, false].map((strictCheckNodes) => runTests(strictCheckNodes));
