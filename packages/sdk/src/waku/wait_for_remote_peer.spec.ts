import type { Connection, Peer, PeerStore } from "@libp2p/interface";
import {
  FilterCodecs,
  LightPushCodec,
  LightPushCodecV2,
  StoreCodec
} from "@waku/core";
import { IRelay, Protocols } from "@waku/interfaces";
import { expect } from "chai";
import sinon from "sinon";

import { waitForRemotePeer } from "./wait_for_remote_peer.js";
import { WakuNode } from "./waku.js";

describe("waitForRemotePeer", () => {
  let eventTarget = new EventTarget();

  beforeEach(() => {
    eventTarget = new EventTarget();
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should reject if WakuNode is not started", async () => {
    const wakuMock = mockWakuNode({
      connections: [{}]
    });

    let err: Error | undefined = undefined;
    try {
      await waitForRemotePeer(wakuMock);
    } catch (e) {
      err = e as Error;
    }

    expect(err).not.to.be.undefined;
    expect(err!.message).to.be.eq("Waku node is not started");
  });

  it("should reject if Relay is requested but not mounted", async () => {
    const wakuMock = mockWakuNode({ isStarted: true });
    wakuMock.relay = undefined;

    let err: Error | undefined = undefined;
    try {
      await waitForRemotePeer(wakuMock, [Protocols.Relay]);
    } catch (e) {
      err = e as Error;
    }

    expect(err).not.to.be.undefined;
    expect(err!.message).to.be.eq(
      "Cannot wait for Relay peer: protocol not mounted"
    );
  });

  it("should reject if LightPush is requested but not mounted", async () => {
    const wakuMock = mockWakuNode({ isStarted: true });
    wakuMock.lightPush = undefined;

    let err: Error | undefined = undefined;
    try {
      await waitForRemotePeer(wakuMock, [Protocols.LightPush]);
    } catch (e) {
      err = e as Error;
    }

    expect(err).not.to.be.undefined;
    expect(err!.message).to.be.eq(
      "Cannot wait for LightPush peer: protocol not mounted"
    );
  });

  it("should reject if Store is requested but not mounted", async () => {
    const wakuMock = mockWakuNode({ isStarted: true });
    wakuMock.store = undefined;

    let err: Error | undefined = undefined;
    try {
      await waitForRemotePeer(wakuMock, [Protocols.Store]);
    } catch (e) {
      err = e as Error;
    }

    expect(err).not.to.be.undefined;
    expect(err!.message).to.be.eq(
      "Cannot wait for Store peer: protocol not mounted"
    );
  });

  it("should reject if Filter is requested but not mounted", async () => {
    const wakuMock = mockWakuNode({ isStarted: true });
    wakuMock.filter = undefined;

    let err: Error | undefined = undefined;
    try {
      await waitForRemotePeer(wakuMock, [Protocols.Filter]);
    } catch (e) {
      err = e as Error;
    }

    expect(err).not.to.be.undefined;
    expect(err!.message).to.be.eq(
      "Cannot wait for Filter peer: protocol not mounted"
    );
  });

  it("should reject on timeout if it was set", async () => {
    const addEventListenerSpy = sinon.spy(eventTarget.addEventListener);
    eventTarget.addEventListener = addEventListenerSpy;

    const wakuMock = mockWakuNode({ isStarted: true, eventTarget });

    // let's wait for LightPush in that test
    wakuMock.lightPush = {} as any;

    let err: Error | undefined = undefined;
    try {
      await waitForRemotePeer(wakuMock, [Protocols.LightPush], 10);
    } catch (e) {
      err = e as Error;
    }

    expect(addEventListenerSpy.calledTwice).to.be.true;
    addEventListenerSpy
      .getCalls()
      .forEach((c) => expect(c.firstArg).to.equal("peer:identify"));

    expect(err).not.to.be.undefined;
    expect(err!.message).to.be.eq("Timed out waiting for a remote peer.");
  });

  it("should check connected peers if present and suitable", async () => {
    const removeEventListenerSpy = sinon.spy(eventTarget.removeEventListener);
    eventTarget.removeEventListener = removeEventListenerSpy;

    const wakuNode = mockWakuNode({
      isStarted: true,
      eventTarget,
      connections: [{}],
      peers: [
        mockPeer("1", []),
        mockPeer("1.1", ["random"]),
        mockPeer("2", ["random", LightPushCodec])
      ],
      metadataService: mockMetadataService("resolve")
    });

    let err: Error | undefined;
    try {
      await waitForRemotePeer(wakuNode, [Protocols.LightPush]);
    } catch (e) {
      err = e as Error;
    }

    expect(err).to.be.undefined;
    expect(removeEventListenerSpy.notCalled).to.be.true;
  });

  it("should wait for LightPush peer to be connected", async () => {
    let call = 0;
    const addEventListenerSpy = sinon.spy(
      (_type: string, _cb: (e: any) => void) => {
        const proto = call === 0 ? LightPushCodec : LightPushCodecV2;
        call++;
        _cb({ detail: { protocols: [proto] } });
      }
    );
    eventTarget.addEventListener = addEventListenerSpy;

    // check without metadata service
    let wakuNode = mockWakuNode({
      isStarted: true,
      eventTarget,
      connections: [{}],
      peers: [
        mockPeer("1", []),
        mockPeer("1.1", ["random"]),
        mockPeer("2", ["random"])
      ]
    });

    let err: Error | undefined;
    try {
      await waitForRemotePeer(wakuNode, [Protocols.LightPush]);
    } catch (e) {
      err = e as Error;
    }

    expect(addEventListenerSpy.calledTwice).to.be.true;
    addEventListenerSpy
      .getCalls()
      .forEach((c) => expect(c.firstArg).to.equal("peer:identify"));
    expect(err).to.be.undefined;

    // check with metadata serivice
    wakuNode = mockWakuNode({
      isStarted: true,
      eventTarget,
      connections: [{}],
      peers: [
        mockPeer("1", []),
        mockPeer("1.1", ["random"]),
        mockPeer("2", ["random"])
      ],
      metadataService: mockMetadataService("resolve")
    });

    try {
      await waitForRemotePeer(wakuNode, [Protocols.LightPush]);
    } catch (e) {
      err = e as Error;
    }

    expect(addEventListenerSpy.callCount).to.equal(4);
    addEventListenerSpy
      .getCalls()
      .forEach((c) => expect(c.firstArg).to.equal("peer:identify"));
    expect(err).to.be.undefined;
  });

  it("should wait for Filter peer to be connected", async () => {
    const addEventListenerSpy = sinon.spy(
      (_type: string, _cb: (e: any) => void) => {
        _cb({ detail: { protocols: [FilterCodecs.SUBSCRIBE] } });
      }
    );
    eventTarget.addEventListener = addEventListenerSpy;

    // check without metadata service
    let wakuNode = mockWakuNode({
      isStarted: true,
      eventTarget,
      connections: [{}],
      peers: [
        mockPeer("1", []),
        mockPeer("1.1", ["random"]),
        mockPeer("2", ["random"])
      ]
    });

    let err: Error | undefined;
    try {
      await waitForRemotePeer(wakuNode, [Protocols.Filter]);
    } catch (e) {
      err = e as Error;
    }

    expect(addEventListenerSpy.calledOnceWith("peer:identify")).to.be.true;
    expect(err).to.be.undefined;

    // check with metadata serivice
    wakuNode = mockWakuNode({
      isStarted: true,
      eventTarget,
      connections: [{}],
      peers: [
        mockPeer("1", []),
        mockPeer("1.1", ["random"]),
        mockPeer("2", ["random"])
      ],
      metadataService: mockMetadataService("resolve")
    });

    try {
      await waitForRemotePeer(wakuNode, [Protocols.Filter]);
    } catch (e) {
      err = e as Error;
    }

    expect(addEventListenerSpy.calledTwice).to.be.true;
    expect(addEventListenerSpy.lastCall.calledWith("peer:identify")).to.be.true;
    expect(err).to.be.undefined;
  });

  it("should wait for Store peer to be connected", async () => {
    const addEventListenerSpy = sinon.spy(
      (_type: string, _cb: (e: any) => void) => {
        _cb({ detail: { protocols: [StoreCodec] } });
      }
    );
    eventTarget.addEventListener = addEventListenerSpy;

    // check without metadata service
    let wakuNode = mockWakuNode({
      isStarted: true,
      eventTarget,
      connections: [{}],
      peers: [
        mockPeer("1", []),
        mockPeer("1.1", ["random"]),
        mockPeer("2", ["random"])
      ]
    });

    let err: Error | undefined;
    try {
      await waitForRemotePeer(wakuNode, [Protocols.Store]);
    } catch (e) {
      err = e as Error;
    }

    expect(addEventListenerSpy.calledOnceWith("peer:identify")).to.be.true;
    expect(err).to.be.undefined;

    // check with metadata serivice
    wakuNode = mockWakuNode({
      isStarted: true,
      eventTarget,
      connections: [{}],
      peers: [
        mockPeer("1", []),
        mockPeer("1.1", ["random"]),
        mockPeer("2", ["random"])
      ],
      metadataService: mockMetadataService("resolve")
    });

    try {
      await waitForRemotePeer(wakuNode, [Protocols.Store]);
    } catch (e) {
      err = e as Error;
    }

    expect(addEventListenerSpy.calledTwice).to.be.true;
    expect(addEventListenerSpy.lastCall.calledWith("peer:identify")).to.be.true;
    expect(err).to.be.undefined;
  });

  it("should call waitForPeer on Relay", async () => {
    const waitForRelaySpy = sinon.spy();
    const wakuNode = mockWakuNode({
      isStarted: true,
      eventTarget,
      connections: [{}],
      peers: [
        mockPeer("1", []),
        mockPeer("1.1", ["random"]),
        mockPeer("2", ["random"])
      ]
    });
    wakuNode.relay = { waitForPeers: waitForRelaySpy } as unknown as IRelay;

    let err: Error | undefined;
    try {
      await waitForRemotePeer(wakuNode, [Protocols.Relay]);
    } catch (e) {
      err = e as Error;
    }

    expect(waitForRelaySpy.calledOnceWith()).to.be.true;
    expect(err).to.be.undefined;
  });
});

type MockWakuOptions = {
  isStarted?: boolean;
  connections?: any[];
  peers?: Peer[];
  metadataService?: any;
  eventTarget?: EventTarget;
};

function mockWakuNode(options: MockWakuOptions = {}): WakuNode {
  return {
    filter: {},
    lightPush: {},
    relay: {},
    store: {},
    libp2p: {
      peerStore: mockPeerStore(options?.peers || []),
      services: {
        metadata: options.metadataService
      },
      addEventListener: options?.eventTarget
        ? options.eventTarget.addEventListener.bind(options.eventTarget)
        : undefined,
      removeEventListener: options?.eventTarget
        ? options.eventTarget.removeEventListener.bind(options.eventTarget)
        : undefined,
      getConnections() {
        return (options.connections || []) as Connection[];
      },
      getPeers() {
        return (options?.peers || []).map((p) => p.id);
      }
    },
    isStarted() {
      return options?.isStarted || false;
    }
  } as WakuNode;
}

function mockMetadataService(mode: "resolve" | "reject"): any {
  return {
    confirmOrAttemptHandshake: () => {
      return Promise.resolve(
        mode === "resolve" ? { error: null } : { error: {} }
      );
    }
  };
}

function mockPeerStore(peers: any[]): PeerStore {
  return {
    get(peerId) {
      return Promise.resolve(peers.find((p) => p.id === peerId));
    }
  } as PeerStore;
}

function mockPeer(id: string, protocols: string[]): Peer {
  return {
    id,
    protocols
  } as unknown as Peer;
}
