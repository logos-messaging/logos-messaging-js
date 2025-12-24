import { bootstrap } from "@libp2p/bootstrap";
import type { PeerId } from "@libp2p/interface";
import type {
  IDecodedMessage,
  IWaku,
  LightNode,
  RelayNode
} from "@waku/interfaces";
import { Protocols } from "@waku/interfaces";
import { generateSymmetricKey } from "@waku/message-encryption";
import {
  createDecoder,
  createEncoder
} from "@waku/message-encryption/symmetric";
import { createRelayNode } from "@waku/relay";
import {
  createLightNode,
  createEncoder as createPlainEncoder
} from "@waku/sdk";
import { createRoutingInfo } from "@waku/utils";
import { bytesToUtf8, utf8ToBytes } from "@waku/utils/bytes";
import { expect } from "chai";

import {
  afterEachCustom,
  beforeEachCustom,
  DefaultTestNetworkConfig,
  DefaultTestRoutingInfo,
  makeLogFileName,
  NOISE_KEY_1,
  NOISE_KEY_2,
  ServiceNode,
  tearDownNodes
} from "../src/index.js";

const TestContentTopic = "/test/1/waku/utf8";
const TestRoutingInfo = createRoutingInfo(DefaultTestNetworkConfig, {
  contentTopic: TestContentTopic
});
const TestEncoder = createPlainEncoder({
  contentTopic: TestContentTopic,
  routingInfo: TestRoutingInfo
});

describe("Waku Dial [node only]", function () {
  describe("Interop: ServiceNode", function () {
    let waku: LightNode;
    let nwaku: ServiceNode;

    afterEachCustom(this, async () => {
      await tearDownNodes(nwaku, waku);
    });

    it("connects to nwaku", async function () {
      this.timeout(20_000);
      nwaku = new ServiceNode(makeLogFileName(this));
      await nwaku.start({
        filter: true,
        store: true,
        lightpush: true,
        relay: true
      });
      const multiAddrWithId = await nwaku.getMultiaddrWithId();

      waku = await createLightNode({
        staticNoiseKey: NOISE_KEY_1,
        networkConfig: DefaultTestNetworkConfig
      });
      await waku.start();
      await waku.dial(multiAddrWithId);
      await waku.waitForPeers([
        Protocols.Store,
        Protocols.Filter,
        Protocols.LightPush
      ]);

      const nimPeerId = await nwaku.getPeerId();
      expect(await waku.libp2p.peerStore.has(nimPeerId)).to.be.true;
    });

    it("Does not throw an exception when node disconnects", async function () {
      this.timeout(20_000);

      process.on("unhandledRejection", (e) =>
        expect.fail("unhandledRejection", e)
      );
      process.on("uncaughtException", (e) =>
        expect.fail("uncaughtException", e)
      );

      nwaku = new ServiceNode(makeLogFileName(this));
      await nwaku.start({
        filter: true,
        store: true,
        lightpush: true,
        relay: true
      });
      const multiAddrWithId = await nwaku.getMultiaddrWithId();

      waku = await createLightNode({
        staticNoiseKey: NOISE_KEY_1,
        networkConfig: DefaultTestNetworkConfig
      });
      await waku.start();
      await waku.dial(multiAddrWithId);

      await tearDownNodes(nwaku, []);
      await waku.lightPush?.send(TestEncoder, {
        payload: utf8ToBytes("hello world")
      });
    });
  });

  describe("Bootstrap", function () {
    let waku: LightNode;
    let nwaku: ServiceNode;

    afterEachCustom(this, async () => {
      await tearDownNodes(nwaku, waku);
    });

    it("Passing an array", async function () {
      this.timeout(10_000);

      nwaku = new ServiceNode(makeLogFileName(this));
      await nwaku.start();
      const multiAddrWithId = await nwaku.getMultiaddrWithId();
      waku = await createLightNode({
        staticNoiseKey: NOISE_KEY_1,
        networkConfig: DefaultTestNetworkConfig,
        libp2p: {
          peerDiscovery: [bootstrap({ list: [multiAddrWithId.toString()] })]
        }
      });
      await waku.start();

      const connectedPeerID: PeerId = await new Promise((resolve) => {
        waku.libp2p.addEventListener("peer:connect", (evt) => {
          resolve(evt.detail);
        });
      });

      expect(connectedPeerID.toString()).to.eq(multiAddrWithId.getPeerId());
    });

    it("Using a function", async function () {
      this.timeout(10_000);

      nwaku = new ServiceNode(makeLogFileName(this));
      await nwaku.start();

      const nwakuMa = await nwaku.getMultiaddrWithId();

      waku = await createLightNode({
        staticNoiseKey: NOISE_KEY_1,
        networkConfig: DefaultTestNetworkConfig,
        libp2p: {
          peerDiscovery: [bootstrap({ list: [nwakuMa.toString()] })]
        }
      });
      await waku.start();

      const connectedPeerID: PeerId = await new Promise((resolve) => {
        waku.libp2p.addEventListener("peer:connect", (evt) => {
          resolve(evt.detail);
        });
      });

      const multiAddrWithId = await nwaku.getMultiaddrWithId();
      expect(connectedPeerID.toString()).to.eq(multiAddrWithId.getPeerId());
    });
  });
});

describe("Decryption Keys", function () {
  afterEachCustom(this, async () => {
    if (this.ctx.currentTest?.state === "failed") {
      console.log(`Test failed, log file name is ${makeLogFileName(this.ctx)}`);
    }
  });

  let waku1: RelayNode;
  let waku2: RelayNode;
  beforeEachCustom(this, async () => {
    [waku1, waku2] = await Promise.all([
      createRelayNode({
        staticNoiseKey: NOISE_KEY_1,
        networkConfig: DefaultTestNetworkConfig,
        routingInfos: [DefaultTestRoutingInfo]
      }).then((waku) => waku.start().then(() => waku)),
      createRelayNode({
        staticNoiseKey: NOISE_KEY_2,
        networkConfig: DefaultTestNetworkConfig,
        routingInfos: [DefaultTestRoutingInfo],
        libp2p: { addresses: { listen: ["/ip4/0.0.0.0/tcp/0/ws"] } }
      }).then((waku) => waku.start().then(() => waku))
    ]);

    await waku1.libp2p.peerStore.merge(waku2.libp2p.peerId, {
      multiaddrs: waku2.libp2p.getMultiaddrs()
    });
    await waku1.dial(waku2.libp2p.peerId);

    await Promise.all([
      waku1.waitForPeers([Protocols.Relay]),
      waku1.waitForPeers([Protocols.Relay])
    ]);
  });

  afterEachCustom(this, async () => {
    await tearDownNodes([], [waku1, waku2]);
  });

  it("Used by Waku Relay", async function () {
    this.timeout(10000);

    const symKey = generateSymmetricKey();
    const decoder = createDecoder(TestContentTopic, TestRoutingInfo, symKey);

    const encoder = createEncoder({
      contentTopic: TestContentTopic,
      routingInfo: TestRoutingInfo,
      symKey
    });

    const messageText = "Message is encrypted";
    const messageTimestamp = new Date("1995-12-17T03:24:00");
    const message = {
      payload: utf8ToBytes(messageText),
      timestamp: messageTimestamp
    };

    const receivedMsgPromise: Promise<IDecodedMessage> = new Promise(
      (resolve) => {
        void waku2.relay.subscribeWithUnsubscribe([decoder], resolve);
      }
    );

    await waku1.relay.send(encoder, message);

    const receivedMsg = await receivedMsgPromise;

    expect(receivedMsg.contentTopic).to.eq(TestContentTopic);
    expect(bytesToUtf8(receivedMsg.payload)).to.eq(messageText);
    expect(receivedMsg.timestamp?.valueOf()).to.eq(messageTimestamp.valueOf());
  });
});

describe("User Agent", function () {
  let waku1: IWaku;
  let waku2: IWaku;

  afterEachCustom(this, async () => {
    await tearDownNodes([], [waku1, waku2]);
  });

  it("Sets default value correctly", async function () {
    this.timeout(20_000);

    const waku1UserAgent = "test-user-agent";

    [waku1, waku2] = await Promise.all([
      createRelayNode({
        staticNoiseKey: NOISE_KEY_1,
        userAgent: waku1UserAgent,
        networkConfig: DefaultTestNetworkConfig,
        routingInfos: [DefaultTestRoutingInfo]
      }).then((waku) => waku.start().then(() => waku)),
      createRelayNode({
        staticNoiseKey: NOISE_KEY_2,
        networkConfig: DefaultTestNetworkConfig,
        routingInfos: [DefaultTestRoutingInfo],
        libp2p: { addresses: { listen: ["/ip4/0.0.0.0/tcp/0/ws"] } }
      }).then((waku) => waku.start().then(() => waku))
    ]);

    await waku1.libp2p.peerStore.save(waku2.libp2p.peerId, {
      multiaddrs: waku2.libp2p.getMultiaddrs()
    });
    await waku1.dial(waku2.libp2p.peerId);
    await waku1.waitForPeers();

    const [waku1PeerInfo, waku2PeerInfo] = await Promise.all([
      waku2.libp2p.peerStore.get(waku1.libp2p.peerId),
      waku1.libp2p.peerStore.get(waku2.libp2p.peerId)
    ]);

    expect(bytesToUtf8(waku1PeerInfo.metadata.get("AgentVersion")!)).to.eq(
      waku1UserAgent
    );
    expect(bytesToUtf8(waku2PeerInfo.metadata.get("AgentVersion")!)).to.eq(
      "js-waku"
    );
  });
});
