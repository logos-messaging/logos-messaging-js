import type { LightNode, PartialPeerInfo, PeerCache } from "@waku/interfaces";
import { createLightNode } from "@waku/sdk";
import { expect } from "chai";
import Sinon, { SinonSpy } from "sinon";

import {
  afterEachCustom,
  beforeEachCustom,
  DefaultTestClusterId,
  DefaultTestNetworkConfig,
  DefaultTestShardInfo,
  makeLogFileName,
  ServiceNode,
  tearDownNodes
} from "../../src/index.js";

class MockPeerCache implements PeerCache {
  public data: PartialPeerInfo[] = [];

  public get(): PartialPeerInfo[] {
    return this.data;
  }

  public set(value: PartialPeerInfo[]): void {
    this.data = value;
  }

  public remove(): void {
    this.data = [];
  }
}

describe("Peer Cache Discovery", function () {
  this.timeout(150_000);
  let ctx: Mocha.Context;
  let waku: LightNode;

  let nwaku1: ServiceNode;
  let nwaku2: ServiceNode;

  let dialPeerSpy: SinonSpy;

  beforeEachCustom(this, async () => {
    ctx = this.ctx;

    nwaku1 = new ServiceNode(makeLogFileName(ctx) + "1");
    nwaku2 = new ServiceNode(makeLogFileName(ctx) + "2");

    await nwaku1.start({
      clusterId: DefaultTestClusterId,
      shard: DefaultTestShardInfo.shards,
      discv5Discovery: true,
      peerExchange: true,
      relay: true
    });

    await nwaku2.start({
      clusterId: DefaultTestClusterId,
      shard: DefaultTestShardInfo.shards,
      discv5Discovery: true,
      peerExchange: true,
      discv5BootstrapNode: (await nwaku1.info()).enrUri,
      relay: true
    });
  });

  afterEachCustom(this, async () => {
    await tearDownNodes([nwaku1, nwaku2], waku);
  });

  it("should discover peers from provided peer cache", async function () {
    const mockCache = new MockPeerCache();
    const peerId1 = (await nwaku1.getPeerId()).toString();
    const peerId2 = (await nwaku2.getPeerId()).toString();

    mockCache.set([
      {
        id: peerId1,
        multiaddrs: [(await nwaku1.getMultiaddrWithId()).toString()]
      },
      {
        id: peerId2,
        multiaddrs: [(await nwaku2.getMultiaddrWithId()).toString()]
      }
    ]);

    waku = await createLightNode({
      networkConfig: DefaultTestNetworkConfig,
      discovery: {
        peerExchange: false,
        peerCache: true
      },
      peerCache: mockCache
    });

    dialPeerSpy = Sinon.spy((waku as any).libp2p, "dial");

    const discoveredPeers = new Set<string>();
    await new Promise<void>((resolve) => {
      waku.libp2p.addEventListener("peer:identify", (evt) => {
        discoveredPeers.add(evt.detail.peerId.toString());

        if (discoveredPeers.has(peerId1) && discoveredPeers.has(peerId2)) {
          resolve();
        }
      });
    });

    expect(dialPeerSpy.callCount).to.be.greaterThanOrEqual(2);
    expect(discoveredPeers).to.include(peerId1);
    expect(discoveredPeers).to.include(peerId2);
  });

  it("should monitor connected peers and store them into cache", async function () {
    const mockCache = new MockPeerCache();
    const targetPeerId = (await nwaku2.getPeerId()).toString();

    waku = await createLightNode({
      networkConfig: DefaultTestNetworkConfig,
      bootstrapPeers: [(await nwaku2.getMultiaddrWithId()).toString()],
      discovery: {
        peerExchange: false,
        peerCache: true
      },
      peerCache: mockCache
    });

    const discoveredPeers = new Set<string>();

    await new Promise<void>((resolve) => {
      waku.libp2p.addEventListener("peer:identify", (evt) => {
        discoveredPeers.add(evt.detail.peerId.toString());

        if (discoveredPeers.has(targetPeerId)) {
          resolve();
        }
      });
    });

    expect(discoveredPeers).to.include(targetPeerId);

    const cachedPeers = mockCache.get();
    const isTargetCached = cachedPeers.some((p) => p.id === targetPeerId);
    expect(isTargetCached).to.be.true;
  });
});
