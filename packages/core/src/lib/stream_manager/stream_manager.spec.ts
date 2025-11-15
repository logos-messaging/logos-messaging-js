import { Connection, Peer, PeerId, Stream } from "@libp2p/interface";
import { Libp2pComponents } from "@waku/interfaces";
import { expect } from "chai";
import sinon from "sinon";

import { StreamManager } from "./stream_manager.js";

const MULTICODEC = "/test";

describe("StreamManager", () => {
  let eventTarget: EventTarget;
  let streamManager: StreamManager;

  const mockPeer: Peer = {
    id: {
      toString() {
        return "1";
      }
    }
  } as unknown as Peer;

  beforeEach(() => {
    eventTarget = new EventTarget();
    streamManager = new StreamManager(MULTICODEC, {
      connectionManager: { getConnections: () => [] },
      events: eventTarget
    } as any as Libp2pComponents);
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should return usable stream attached to connection", async () => {
    for (const writeStatus of ["ready", "writing"]) {
      const con1 = createMockConnection();
      con1.streams = [
        createMockStream({ id: "1", protocol: MULTICODEC, writeStatus })
      ];

      streamManager["libp2p"]["connectionManager"]["getConnections"] = (
        _peerId: PeerId | undefined
      ) => [con1];

      const stream = await streamManager.getStream(mockPeer.id);

      expect(stream).not.to.be.undefined;
      expect(stream?.id).to.be.eq("1");
    }
  });

  it("should return undefined if no connection provided", async () => {
    streamManager["libp2p"]["connectionManager"]["getConnections"] = (
      _peerId: PeerId | undefined
    ) => [];

    const stream = await streamManager.getStream(mockPeer.id);
    expect(stream).to.be.undefined;
  });

  it("should create a new stream if no existing for protocol found", async () => {
    for (const writeStatus of ["done", "closed", "closing"]) {
      const con1 = createMockConnection();
      con1.streams = [
        createMockStream({ id: "1", protocol: MULTICODEC, writeStatus })
      ];

      const newStreamSpy = sinon.spy(async (_protocol, _options) =>
        createMockStream({
          id: "2",
          protocol: MULTICODEC,
          writeStatus: "writable"
        })
      );

      con1.newStream = newStreamSpy;
      streamManager["libp2p"]["connectionManager"]["getConnections"] = (
        _peerId: PeerId | undefined
      ) => [con1];

      const stream = await streamManager.getStream(mockPeer.id);

      expect(stream).not.to.be.undefined;
      expect(stream?.id).to.be.eq("2");

      expect(newStreamSpy.calledOnce).to.be.true;
      expect(newStreamSpy.calledWith(MULTICODEC)).to.be.true;
    }
  });

  it("should return different streams if requested simultaniously", async () => {
    const con1 = createMockConnection();
    con1.streams = [createMockStream({ id: "1", protocol: MULTICODEC })];

    const newStreamSpy = sinon.spy(async (_protocol, _options) =>
      createMockStream({
        id: "2",
        protocol: MULTICODEC,
        writeStatus: "writable"
      })
    );

    con1.newStream = newStreamSpy;
    streamManager["libp2p"]["connectionManager"]["getConnections"] = (
      _peerId: PeerId | undefined
    ) => [con1];

    const [stream1, stream2] = await Promise.all([
      streamManager.getStream(mockPeer.id),
      streamManager.getStream(mockPeer.id)
    ]);

    expect(stream1).to.not.be.undefined;
    expect(stream2).to.not.be.undefined;

    const expected = ["1", "2"].toString();
    const actual = [stream1?.id, stream2?.id].sort().toString();

    expect(actual).to.be.eq(expected);
  });

  it("peer:update - should do nothing if another protocol hit", async () => {
    const scheduleNewStreamSpy = sinon.spy();
    streamManager["scheduleNewStream"] = scheduleNewStreamSpy;
    eventTarget.dispatchEvent(
      new CustomEvent("peer:update", {
        detail: { peer: { id: mockPeer.id, protocols: [] } }
      })
    );

    expect(scheduleNewStreamSpy.calledOnce).to.be.false;
  });

  it("peer:update - should schedule stream creation IF protocol hit AND no stream found on connection", async () => {
    const scheduleNewStreamSpy = sinon.spy();
    streamManager["scheduleNewStream"] = scheduleNewStreamSpy;
    eventTarget.dispatchEvent(
      new CustomEvent("peer:update", {
        detail: { peer: { id: mockPeer.id, protocols: [MULTICODEC] } }
      })
    );

    expect(scheduleNewStreamSpy.calledOnce).to.be.true;
  });

  it("peer:update - should not schedule stream creation IF protocol hit AND stream found on connection", async () => {
    const con1 = createMockConnection();
    con1.streams = [
      createMockStream({
        id: "1",
        protocol: MULTICODEC,
        writeStatus: "writable"
      })
    ];
    streamManager["libp2p"]["connectionManager"]["getConnections"] = (
      _id: PeerId | undefined
    ) => [con1];

    const scheduleNewStreamSpy = sinon.spy();
    streamManager["scheduleNewStream"] = scheduleNewStreamSpy;

    eventTarget.dispatchEvent(
      new CustomEvent("peer:update", {
        detail: { peer: { id: mockPeer.id, protocols: [MULTICODEC] } }
      })
    );

    expect(scheduleNewStreamSpy.calledOnce).to.be.false;
  });
});

type MockConnectionOptions = {
  status?: string;
  open?: number;
};

function createMockConnection(options: MockConnectionOptions = {}): Connection {
  return {
    status: options.status || "open",
    timeline: {
      open: options.open || 1
    }
  } as Connection;
}

type MockStreamOptions = {
  id?: string;
  protocol?: string;
  writeStatus?: string;
};

function createMockStream(options: MockStreamOptions): Stream {
  return {
    id: options.id,
    protocol: options.protocol,
    writeStatus: options.writeStatus || "ready",
    metadata: {}
  } as Stream;
}
