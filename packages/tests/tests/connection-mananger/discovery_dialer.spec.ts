import { LightNode } from "@waku/interfaces";
import { expect } from "chai";
import type { Context } from "mocha";

import {
  afterEachCustom,
  beforeEachCustom,
  delay,
  runMultipleNodes,
  ServiceNodesFleet,
  teardownNodesWithRedundancy
} from "../../src/index.js";

import { TestRoutingInfo } from "./utils.js";

// TODO: investigate and re-enable in https://github.com/logos-messaging/logos-messaging-js/issues/2453
describe.skip("DiscoveryDialer", function () {
  const ctx: Context = this.ctx;
  let waku: LightNode;
  let serviceNodes: ServiceNodesFleet;

  beforeEachCustom(this, async () => {
    [serviceNodes, waku] = await runMultipleNodes(
      this.ctx,
      TestRoutingInfo,
      { lightpush: true, filter: true, peerExchange: true },
      false,
      2,
      true
    );

    await teardownNodesWithRedundancy(serviceNodes, []);

    serviceNodes = await ServiceNodesFleet.createAndRun(
      ctx,
      2,
      false,
      TestRoutingInfo,
      {
        lightpush: true,
        filter: true,
        peerExchange: true
      },
      false
    );
  });

  afterEachCustom(this, async () => {
    await teardownNodesWithRedundancy(serviceNodes, waku);
  });

  it("should dial second nwaku node that was discovered", async function () {
    const maddrs = await Promise.all(
      serviceNodes.nodes.map((n) => n.getMultiaddrWithId())
    );

    expect(waku.isConnected(), "waku is connected").to.be.false;
    expect(
      await waku.getConnectedPeers(),
      "waku has no connected peers"
    ).to.have.length(0);

    const connectPromise = new Promise((resolve, reject) => {
      waku.libp2p.addEventListener("peer:connect", () => {
        resolve(true);
      });

      setTimeout(() => {
        reject(new Error("Timeout waiting for peer:connect event"));
      }, 1000);
    });

    try {
      await waku.dial(maddrs[0]);
    } catch (error) {
      throw Error(error as string);
    }

    await connectPromise;

    expect(waku.isConnected(), "waku is connected").to.be.true;

    expect(
      await waku.getConnectedPeers(),
      "waku has one connected peer"
    ).to.have.length(1);

    const secondPeerId = await serviceNodes.nodes[1].getPeerId();
    const discoveryPromise = new Promise((resolve) => {
      waku.libp2p.addEventListener("peer:discovery", (event) => {
        if (event.detail.id.equals(secondPeerId)) {
          resolve(true);
        }
      });
    });

    await waku.libp2p.peerStore.save(secondPeerId, {
      multiaddrs: [maddrs[1]]
    });

    await discoveryPromise;
    await delay(500);

    expect(
      waku.libp2p.getConnections(),
      "waku has two connections"
    ).to.have.length(2);
  });
});
