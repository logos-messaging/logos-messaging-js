import { type Connection, type Peer, type PeerId } from "@libp2p/interface";
import { multiaddr } from "@multiformats/multiaddr";
import {
  CONNECTION_LOCKED_TAG,
  IWakuEventEmitter,
  Tags,
  WakuEvent
} from "@waku/interfaces";
import { expect } from "chai";
import sinon from "sinon";

import { ConnectionLimiter } from "./connection_limiter.js";
import { Dialer } from "./dialer.js";
import { NetworkMonitor } from "./network_monitor.js";

describe("ConnectionLimiter", () => {
  let libp2p: any;
  let events: IWakuEventEmitter;
  let dialer: sinon.SinonStubbedInstance<Dialer>;
  let networkMonitor: sinon.SinonStubbedInstance<NetworkMonitor>;
  let connectionLimiter: ConnectionLimiter;
  let mockPeerId: PeerId;

  let mockConnection: Connection;

  let mockPeer: Peer;
  let mockPeer2: Peer;

  const createMockPeerId = (id: string): PeerId =>
    ({
      toString: () => id,
      equals: function (other: PeerId) {
        return (
          other &&
          typeof other.toString === "function" &&
          other.toString() === id
        );
      }
    }) as PeerId;

  const createMockPeer = (id: string, tags: string[] = []): Peer =>
    ({
      id: createMockPeerId(id),
      tags: new Map(tags.map((tag) => [tag, { value: 0 }])),
      addresses: [],
      protocols: [],
      metadata: new Map(),
      toString: () => id
    }) as unknown as Peer;

  const createMockConnection = (
    peerId: PeerId,
    tags: string[] = []
  ): Connection =>
    ({
      remotePeer: peerId,
      tags: tags || []
    }) as Connection;

  const defaultOptions = {
    maxConnections: 5,
    maxBootstrapPeers: 2,
    pingKeepAlive: 300,
    relayKeepAlive: 300,
    enableAutoRecovery: true,
    maxDialingPeers: 3,
    failedDialCooldown: 60,
    dialCooldown: 10,
    dialTimeout: 30
  };

  function createLimiter(
    opts: Partial<typeof defaultOptions> = {}
  ): ConnectionLimiter {
    return new ConnectionLimiter({
      libp2p,
      events,
      dialer,
      networkMonitor,
      options: { ...defaultOptions, ...opts }
    });
  }

  beforeEach(() => {
    mockPeerId = createMockPeerId("12D3KooWTest1");

    mockPeer = createMockPeer("12D3KooWTest1", [Tags.BOOTSTRAP]);
    mockPeer2 = createMockPeer("12D3KooWTest2", [Tags.BOOTSTRAP]); // Ensure mockPeer2 is prioritized and dialed
    mockConnection = createMockConnection(mockPeerId, [Tags.BOOTSTRAP]);

    dialer = {
      start: sinon.stub(),
      stop: sinon.stub(),
      dial: sinon.stub().resolves()
    } as unknown as sinon.SinonStubbedInstance<Dialer>;

    libp2p = {
      addEventListener: sinon.stub(),
      removeEventListener: sinon.stub(),
      dial: sinon.stub().resolves(),
      hangUp: sinon.stub().resolves(),
      getConnections: sinon.stub().returns([]),
      peerStore: {
        all: sinon.stub().resolves([]),
        get: sinon.stub().resolves(mockPeer),
        merge: sinon.stub().resolves()
      },
      components: {
        components: {}
      }
    };

    events = {
      addEventListener: sinon.stub(),
      removeEventListener: sinon.stub(),
      dispatchEvent: sinon.stub()
    } as any;

    networkMonitor = {
      start: sinon.stub(),
      stop: sinon.stub(),
      isBrowserConnected: sinon.stub().returns(true),
      isConnected: sinon.stub().returns(true),
      isP2PConnected: sinon.stub().returns(true)
    } as unknown as sinon.SinonStubbedInstance<NetworkMonitor>;

    // Mock the libp2p components needed by isAddressesSupported
    libp2p.components = {
      components: {},
      transportManager: {
        getTransports: sinon.stub().returns([
          {
            dialFilter: sinon
              .stub()
              .returns([multiaddr("/dns4/test/tcp/443/wss")])
          }
        ])
      }
    };
  });

  afterEach(() => {
    if (connectionLimiter) {
      connectionLimiter.stop();
    }
    sinon.restore();
  });

  describe("start", () => {
    beforeEach(() => {
      connectionLimiter = createLimiter();
    });

    it("should dial peers from store on start", async () => {
      const dialPeersStub = sinon.stub(
        connectionLimiter as any,
        "dialPeersFromStore"
      );

      connectionLimiter.start();

      expect(dialPeersStub.calledOnce).to.be.true;
    });

    it("should add event listeners for waku:connection and peer:disconnect", () => {
      connectionLimiter.start();

      expect((events.addEventListener as sinon.SinonStub).calledOnce).to.be
        .true;
      expect(
        (events.addEventListener as sinon.SinonStub).calledWith(
          WakuEvent.Connection,
          sinon.match.func
        )
      ).to.be.true;

      expect(libp2p.addEventListener.calledOnce).to.be.true;
      expect(
        libp2p.addEventListener.calledWith("peer:disconnect", sinon.match.func)
      ).to.be.true;
    });

    it("should be safe to call multiple times", () => {
      connectionLimiter.start();
      connectionLimiter.start();

      expect((events.addEventListener as sinon.SinonStub).callCount).to.equal(
        2
      );
      expect(libp2p.addEventListener.callCount).to.equal(2);
    });
  });

  describe("stop", () => {
    beforeEach(() => {
      connectionLimiter = createLimiter();
      connectionLimiter.start();
    });

    it("should remove event listeners", () => {
      connectionLimiter.stop();

      expect((events.removeEventListener as sinon.SinonStub).calledOnce).to.be
        .true;
      expect(
        (events.removeEventListener as sinon.SinonStub).calledWith(
          WakuEvent.Connection,
          sinon.match.func
        )
      ).to.be.true;

      expect(libp2p.removeEventListener.calledOnce).to.be.true;
      expect(
        libp2p.removeEventListener.calledWith(
          "peer:disconnect",
          sinon.match.func
        )
      ).to.be.true;
    });

    it("should be safe to call multiple times", () => {
      connectionLimiter.stop();
      connectionLimiter.stop();

      expect(
        (events.removeEventListener as sinon.SinonStub).callCount
      ).to.equal(2);
      expect(libp2p.removeEventListener.callCount).to.equal(2);
    });
  });

  describe("onWakuConnectionEvent", () => {
    let eventHandler: () => void;

    beforeEach(() => {
      connectionLimiter = createLimiter();
      connectionLimiter.start();

      const addEventListenerStub = events.addEventListener as sinon.SinonStub;
      eventHandler = addEventListenerStub.getCall(0).args[1];
    });

    it("should dial peers from store when browser is connected", () => {
      const dialPeersStub = sinon.stub(
        connectionLimiter as any,
        "dialPeersFromStore"
      );
      networkMonitor.isBrowserConnected.returns(true);

      eventHandler();

      expect(dialPeersStub.calledOnce).to.be.true;
    });

    it("should not dial peers from store when browser is not connected", () => {
      const dialPeersStub = sinon.stub(
        connectionLimiter as any,
        "dialPeersFromStore"
      );
      networkMonitor.isBrowserConnected.returns(false);

      eventHandler();

      expect(dialPeersStub.called).to.be.false;
    });
  });

  describe("onDisconnectedEvent", () => {
    let eventHandler: () => Promise<void>;

    beforeEach(() => {
      connectionLimiter = createLimiter();
      connectionLimiter.start();

      const addEventListenerStub = libp2p.addEventListener as sinon.SinonStub;
      eventHandler = addEventListenerStub.getCall(0).args[1];
    });

    it("should dial peers from store when no connections remain", async () => {
      libp2p.getConnections.returns([]);
      const dialPeersStub = sinon.stub(
        connectionLimiter as any,
        "dialPeersFromStore"
      );
      await eventHandler();
      expect(dialPeersStub.calledOnce).to.be.true;
    });

    it("should do nothing when connections still exist", async () => {
      libp2p.getConnections.returns([mockConnection]);
      const dialPeersStub = sinon.stub(
        connectionLimiter as any,
        "dialPeersFromStore"
      );
      await eventHandler();
      expect(dialPeersStub.called).to.be.false;
    });
  });

  describe("dialPeersFromStore", () => {
    beforeEach(() => {
      libp2p.hangUp = sinon.stub().resolves();
      connectionLimiter = createLimiter();
      mockPeer.addresses = [
        {
          multiaddr: multiaddr("/dns4/mockpeer/tcp/443/wss"),
          isCertified: false
        }
      ];
      mockPeer2.addresses = [
        {
          multiaddr: multiaddr("/dns4/mockpeer2/tcp/443/wss"),
          isCertified: false
        }
      ];
    });

    it("should get all peers from store", async () => {
      libp2p.peerStore.all.resolves([mockPeer, mockPeer2]);
      libp2p.getConnections.returns([]);
      await (connectionLimiter as any).dialPeersFromStore();
      expect(libp2p.peerStore.all.calledOnce).to.be.true;
    });

    it("should filter out already connected peers", async () => {
      dialer.dial.resetHistory();
      libp2p.hangUp.resetHistory();
      libp2p.peerStore.all.resolves([mockPeer, mockPeer2]);
      libp2p.getConnections.returns([createMockConnection(mockPeer.id, [])]);
      await (connectionLimiter as any).dialPeersFromStore();
      expect(dialer.dial.calledOnce).to.be.true;
      expect(dialer.dial.calledWith(mockPeer2.id)).to.be.true;
      expect(dialer.dial.calledWith(mockPeer.id)).to.be.false;
    });

    it("should dial all remaining peers", async () => {
      dialer.dial.resetHistory();
      libp2p.hangUp.resetHistory();
      libp2p.peerStore.all.resolves([mockPeer, mockPeer2]);
      libp2p.getConnections.returns([]);
      await (connectionLimiter as any).dialPeersFromStore();
      expect(dialer.dial.callCount).to.equal(2);
      expect(dialer.dial.calledWith(mockPeer.id)).to.be.true;
      expect(dialer.dial.calledWith(mockPeer2.id)).to.be.true;
    });

    it("should handle dial errors gracefully", async () => {
      libp2p.peerStore.all.resolves([mockPeer]);
      libp2p.getConnections.returns([]);
      dialer.dial.rejects(new Error("Dial failed"));
      await (connectionLimiter as any).dialPeersFromStore();
      expect(dialer.dial.calledOnce).to.be.true;
    });

    it("should handle case with no peers in store", async () => {
      libp2p.peerStore.all.resolves([]);
      libp2p.getConnections.returns([]);
      await (connectionLimiter as any).dialPeersFromStore();
      expect(dialer.dial.called).to.be.false;
    });

    it("should handle case with all peers already connected", async () => {
      libp2p.peerStore.all.resolves([mockPeer]);
      libp2p.getConnections.returns([createMockConnection(mockPeer.id)]);
      await (connectionLimiter as any).dialPeersFromStore();
      expect(dialer.dial.called).to.be.false;
    });
  });

  describe("getPeer", () => {
    beforeEach(() => {
      connectionLimiter = createLimiter();
    });

    it("should return peer for existing peer", async () => {
      const peer = await (connectionLimiter as any).getPeer(mockPeerId);

      expect(libp2p.peerStore.get.calledWith(mockPeerId)).to.be.true;
      expect(peer).to.equal(mockPeer);
    });

    it("should return null for non-existent peer", async () => {
      libp2p.peerStore.get.rejects(new Error("Peer not found"));

      const peer = await (connectionLimiter as any).getPeer(mockPeerId);

      expect(peer).to.be.null;
    });

    it("should handle peer store errors gracefully", async () => {
      libp2p.peerStore.get.rejects(new Error("Database error"));

      const peer = await (connectionLimiter as any).getPeer(mockPeerId);

      expect(peer).to.be.null;
    });
  });

  describe("autoRecovery flag", () => {
    it("should not dial on waku:connection if enableAutoRecovery is false, but should dial on start", () => {
      connectionLimiter = createLimiter({ enableAutoRecovery: false });
      const dialPeersStub = sinon.stub(
        connectionLimiter as any,
        "dialPeersFromStore"
      );
      connectionLimiter.start();
      expect(connectionLimiter["connectionMonitorInterval"]).to.be.null;
      connectionLimiter["onWakuConnectionEvent"]();
      expect(dialPeersStub.calledOnce).to.be.true;
    });

    it("should start connection monitor interval and dial on waku:connection if enableAutoRecovery is true", () => {
      connectionLimiter = createLimiter({ enableAutoRecovery: true });
      const dialPeersStub = sinon.stub(
        connectionLimiter as any,
        "dialPeersFromStore"
      );
      connectionLimiter.start();
      expect(connectionLimiter["connectionMonitorInterval"]).to.not.be.null;
      connectionLimiter["onWakuConnectionEvent"]();
      expect(dialPeersStub.calledTwice).to.be.true;
    });
  });

  describe("maintainConnectionsCount", () => {
    beforeEach(() => {
      libp2p.hangUp = sinon.stub().resolves();
      connectionLimiter = createLimiter({ maxConnections: 2 });
      mockPeer.addresses = [
        {
          multiaddr: multiaddr("/dns4/mockpeer/tcp/443/wss"),
          isCertified: false
        }
      ];
      mockPeer2.addresses = [
        {
          multiaddr: multiaddr("/dns4/mockpeer2/tcp/443/wss"),
          isCertified: false
        }
      ];
    });

    it("should dial more peers if under maxConnections", async () => {
      libp2p.getConnections.returns([]);
      sinon
        .stub(connectionLimiter as any, "getPrioritizedPeers")
        .resolves([mockPeer, mockPeer2]);
      await (connectionLimiter as any).maintainConnectionsCount();
      expect(dialer.dial.calledTwice).to.be.true;
    });

    it("should drop only non-locked connections when over maxConnections", async () => {
      dialer.dial.resetHistory();
      libp2p.hangUp.resetHistory();
      const lockedConn = createMockConnection(mockPeerId, [
        CONNECTION_LOCKED_TAG
      ]);
      const normalConn1 = createMockConnection(createMockPeerId("p2"), []);
      const normalConn2 = createMockConnection(createMockPeerId("p3"), []);
      const normalConn3 = createMockConnection(createMockPeerId("p4"), []);
      const connections = [lockedConn, normalConn1, normalConn2, normalConn3];
      libp2p.getConnections.returns(connections);
      sinon.stub(connectionLimiter as any, "getPrioritizedPeers").resolves([]);
      await (connectionLimiter as any).maintainConnectionsCount();

      expect(libp2p.hangUp.callCount).to.equal(1);
      expect(libp2p.hangUp.calledWith(normalConn3.remotePeer)).to.be.true;
      expect(libp2p.hangUp.calledWith(normalConn1.remotePeer)).to.be.false;
      expect(libp2p.hangUp.calledWith(normalConn2.remotePeer)).to.be.false;
      expect(libp2p.hangUp.calledWith(lockedConn.remotePeer)).to.be.false;
    });

    it("should do nothing if no non-locked connections to drop", async () => {
      const lockedConn1 = createMockConnection(createMockPeerId("p1"), [
        CONNECTION_LOCKED_TAG
      ]);
      const lockedConn2 = createMockConnection(createMockPeerId("p2"), [
        CONNECTION_LOCKED_TAG
      ]);
      libp2p.getConnections.returns([lockedConn1, lockedConn2]);
      sinon.stub(connectionLimiter as any, "getPrioritizedPeers").resolves([]);
      await (connectionLimiter as any).maintainConnectionsCount();
      expect(libp2p.hangUp.called).to.be.false;
    });
  });

  describe("maintainBootstrapConnections", () => {
    beforeEach(() => {
      connectionLimiter = createLimiter({ maxBootstrapPeers: 2 });
    });

    it("should do nothing if at or below maxBootstrapPeers", async () => {
      sinon
        .stub(connectionLimiter as any, "getBootstrapPeers")
        .resolves([mockPeer, mockPeer2]);
      await (connectionLimiter as any).maintainBootstrapConnections();
      expect(libp2p.hangUp.called).to.be.false;
    });

    it("should drop excess bootstrap peers if over maxBootstrapPeers", async () => {
      const p1 = createMockPeer("p1", [Tags.BOOTSTRAP]);
      const p2 = createMockPeer("p2", [Tags.BOOTSTRAP]);
      const p3 = createMockPeer("p3", [Tags.BOOTSTRAP]);
      sinon
        .stub(connectionLimiter as any, "getBootstrapPeers")
        .resolves([p1, p2, p3]);
      await (connectionLimiter as any).maintainBootstrapConnections();
      expect(libp2p.hangUp.calledOnce).to.be.true;
      expect(libp2p.hangUp.calledWith(p3.id)).to.be.true;
    });
  });

  describe("dialPeersFromStore prioritization", () => {
    beforeEach(() => {
      connectionLimiter = createLimiter();
    });

    it("should prioritize bootstrap, then peer exchange, then local peers", async () => {
      const bootstrapPeer = createMockPeer("b", [Tags.BOOTSTRAP]);
      bootstrapPeer.addresses = [
        { multiaddr: multiaddr("/dns4/b/tcp/443/wss"), isCertified: false }
      ];
      const pxPeer = createMockPeer("px", [Tags.PEER_EXCHANGE]);
      pxPeer.addresses = [
        { multiaddr: multiaddr("/dns4/px/tcp/443/wss"), isCertified: false }
      ];
      const localPeer = createMockPeer("l", [Tags.PEER_CACHE]);
      localPeer.addresses = [
        { multiaddr: multiaddr("/dns4/l/tcp/443/wss"), isCertified: false }
      ];
      libp2p.peerStore.all.resolves([bootstrapPeer, pxPeer, localPeer]);
      libp2p.getConnections.returns([]);
      connectionLimiter = createLimiter();
      const peers = await (connectionLimiter as any).getPrioritizedPeers();
      expect(peers[0].id.toString()).to.equal("b");
      expect(peers[1].id.toString()).to.equal("px");
      expect(peers[2].id.toString()).to.equal("l");
    });
  });
});
