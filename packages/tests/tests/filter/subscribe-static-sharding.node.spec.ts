import { createDecoder, createEncoder } from "@waku/core";
import { LightNode } from "@waku/interfaces";
import { Protocols, utf8ToBytes } from "@waku/sdk";
import { createRoutingInfo, formatPubsubTopic } from "@waku/utils";

import {
  afterEachCustom,
  beforeEachCustom,
  makeLogFileName,
  MessageCollector,
  runMultipleNodes,
  ServiceNode,
  ServiceNodesFleet,
  tearDownNodes,
  teardownNodesWithRedundancy
} from "../../src/index.js";

import { TestClusterId, TestContentTopic } from "./utils.js";

const runTests = (strictCheckNodes: boolean): void => {
  describe(`Waku Filter: Subscribe: Multiple Service Nodes on Static Shard: Strict Check mode: ${strictCheckNodes}`, function () {
    this.timeout(100000);
    let waku: LightNode;
    let serviceNodes: ServiceNodesFleet;
    const staticNetworkConfig = { clusterId: 9 };
    const routingInfoShard1 = createRoutingInfo(staticNetworkConfig, {
      shardId: 1
    });
    const encoderShard1 = createEncoder({
      contentTopic: TestContentTopic,
      routingInfo: routingInfoShard1
    });
    const decoderShard1 = createDecoder(TestContentTopic, routingInfoShard1);

    beforeEachCustom(this, async () => {
      [serviceNodes, waku] = await runMultipleNodes(
        this.ctx,
        routingInfoShard1,
        undefined,
        strictCheckNodes
      );
    });

    afterEachCustom(this, async () => {
      await teardownNodesWithRedundancy(serviceNodes, waku);
    });

    it("Subscribe and receive messages from 2 nwaku nodes each with different static shards", async function () {
      await waku.filter.subscribe(
        decoderShard1,
        serviceNodes.messageCollector.callback
      );

      // Set up and start a new nwaku node on different shard
      const nwaku2 = new ServiceNode(makeLogFileName(this) + "3");

      try {
        const routingInfoShard2 = createRoutingInfo(staticNetworkConfig, {
          shardId: 2
        });
        const contentTopic2 = "/test/4/waku-filter/default";
        const decoderShard2 = createDecoder(contentTopic2, routingInfoShard2);
        const encoderShard2 = createEncoder({
          contentTopic: contentTopic2,
          routingInfo: routingInfoShard2
        });

        const shardId = 2;
        await nwaku2.start({
          filter: true,
          lightpush: true,
          relay: true,
          clusterId: staticNetworkConfig.clusterId,
          shard: [shardId],
          numShardsInNetwork: 0 // Running static sharding
        });
        await waku.dial(await nwaku2.getMultiaddrWithId());
        await waku.waitForPeers([Protocols.Filter, Protocols.LightPush]);

        await nwaku2.ensureSubscriptions([
          formatPubsubTopic(TestClusterId, shardId)
        ]);

        const messageCollector2 = new MessageCollector();

        await waku.filter.subscribe(decoderShard2, messageCollector2.callback);

        // Making sure that messages are send and received for both subscriptions
        // While loop is done because of https://github.com/logos-messaging/logos-messaging-js/issues/1606
        while (
          !(await serviceNodes.messageCollector.waitForMessages(1)) ||
          !(await messageCollector2.waitForMessages(1))
        ) {
          await waku.lightPush.send(encoderShard1, {
            payload: utf8ToBytes("M1")
          });
          await waku.lightPush.send(encoderShard2, {
            payload: utf8ToBytes("M2")
          });
        }

        serviceNodes.messageCollector.verifyReceivedMessage(0, {
          expectedContentTopic: encoderShard1.contentTopic,
          expectedPubsubTopic: routingInfoShard1.pubsubTopic,
          expectedMessageText: "M1"
        });

        messageCollector2.verifyReceivedMessage(0, {
          expectedContentTopic: encoderShard2.contentTopic,
          expectedPubsubTopic: routingInfoShard2.pubsubTopic,
          expectedMessageText: "M2"
        });
      } catch (e) {
        await tearDownNodes([nwaku2], []);
      }
    });
  });
};

[true, false].map((strictCheckNodes) => runTests(strictCheckNodes));
