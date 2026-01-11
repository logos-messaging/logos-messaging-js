import { PeerId } from "@libp2p/interface";
import { ConnectionManagerOptions, Libp2p } from "@waku/interfaces";
import { expect } from "chai";
import sinon from "sinon";

import { Dialer } from "./dialer.js";
import { ShardReader } from "./shard_reader.js";

describe("Dialer", () => {
  let libp2p: Libp2p;
  let dialer: Dialer;
  let mockShardReader: sinon.SinonStubbedInstance<ShardReader>;
  let mockPeerId: PeerId;
  let mockPeerId2: PeerId;
  let clock: sinon.SinonFakeTimers;
  let mockOptions: ConnectionManagerOptions;

  const createMockPeerId = (id: string): PeerId =>
    ({
      toString: () => id,
      equals: (other: PeerId) => other.toString() === id
    }) as PeerId;

  beforeEach(() => {
    libp2p = {
      dial: sinon.stub().resolves(),
      getPeers: sinon.stub().returns([])
    } as unknown as Libp2p;

    mockShardReader = {
      hasShardInfo: sinon.stub().resolves(false),
      isPeerOnCluster: sinon.stub().resolves(true)
    } as unknown as sinon.SinonStubbedInstance<ShardReader>;

    mockOptions = {
      maxBootstrapPeers: 1,
      pingKeepAlive: 300,
      relayKeepAlive: 300,
      maxDialingPeers: 3,
      failedDialCooldown: 60,
      dialCooldown: 10,
      dialTimeout: 30,
      maxConnections: 10,
      enableAutoRecovery: true
    };

    mockPeerId = createMockPeerId("12D3KooWTest1");
    mockPeerId2 = createMockPeerId("12D3KooWTest2");

    clock = sinon.useFakeTimers({
      now: 1000000000000
    });
  });

  afterEach(() => {
    if (dialer) {
      dialer.stop();
    }
    clock.restore();
    sinon.restore();
  });

  describe("constructor", () => {
    it("should create dialer with libp2p and shardReader", () => {
      dialer = new Dialer({
        libp2p,
        shardReader: mockShardReader,
        options: mockOptions
      });

      expect(dialer).to.be.instanceOf(Dialer);
    });
  });

  describe("start", () => {
    beforeEach(() => {
      dialer = new Dialer({
        libp2p,
        shardReader: mockShardReader,
        options: mockOptions
      });
    });

    it("should start the dialing interval", () => {
      dialer.start();

      expect(clock.countTimers()).to.be.greaterThan(0);
    });

    it("should clear dial history on start", () => {
      dialer.start();

      void dialer.dial(mockPeerId);

      dialer.stop();
      dialer.start();

      const dialStub = libp2p.dial as sinon.SinonStub;
      dialStub.resetHistory();

      void dialer.dial(mockPeerId);

      expect(dialStub.called).to.be.false;
    });

    it("should not create multiple intervals when called multiple times", () => {
      dialer.start();
      dialer.start();

      expect(clock.countTimers()).to.equal(1);
    });
  });

  describe("stop", () => {
    beforeEach(() => {
      dialer = new Dialer({
        libp2p,
        shardReader: mockShardReader,
        options: mockOptions
      });
      dialer.start();
    });

    it("should clear the dialing interval", () => {
      expect(clock.countTimers()).to.be.greaterThan(0);

      dialer.stop();

      expect(clock.countTimers()).to.equal(0);
    });

    it("should clear dial history on stop", () => {
      dialer.stop();

      const dialStub = libp2p.dial as sinon.SinonStub;
      dialStub.resetHistory();

      dialer.start();
      void dialer.dial(mockPeerId);

      expect(dialStub.called).to.be.false;
    });

    it("should be safe to call multiple times", () => {
      dialer.stop();
      dialer.stop();

      expect(clock.countTimers()).to.equal(0);
    });
  });

  describe("dial", () => {
    beforeEach(() => {
      dialer = new Dialer({
        libp2p,
        shardReader: mockShardReader,
        options: mockOptions
      });
      dialer.start();
    });

    it("should dial peer immediately when queue is empty", async () => {
      const dialStub = libp2p.dial as sinon.SinonStub;
      dialStub.resolves();

      await dialer.dial(mockPeerId);

      expect(dialStub.calledOnce).to.be.true;
      expect(dialStub.calledWith(mockPeerId)).to.be.true;
    });

    it("should add peer to queue when queue is not empty", async () => {
      const dialStub = libp2p.dial as sinon.SinonStub;

      let resolveFirstDial: () => void;
      const firstDialPromise = new Promise<void>((resolve) => {
        resolveFirstDial = resolve;
      });
      dialStub.onFirstCall().returns(firstDialPromise);
      dialStub.onSecondCall().resolves();

      const firstDialCall = dialer.dial(mockPeerId);

      await dialer.dial(mockPeerId2);

      expect(dialStub.calledOnce).to.be.true;
      expect(dialStub.calledWith(mockPeerId)).to.be.true;

      resolveFirstDial!();
      await firstDialCall;

      clock.tick(500);
      await Promise.resolve();

      expect(dialStub.calledTwice).to.be.true;
      expect(dialStub.calledWith(mockPeerId2)).to.be.true;
    });

    it("should skip peer when already connected", async () => {
      const getPeersStub = libp2p.getPeers as sinon.SinonStub;
      getPeersStub.returns([mockPeerId]);

      const dialStub = libp2p.dial as sinon.SinonStub;

      await dialer.dial(mockPeerId);

      expect(dialStub.called).to.be.false;
    });

    it("should skip peer when dialed recently", async () => {
      const dialStub = libp2p.dial as sinon.SinonStub;
      dialStub.resolves();

      await dialer.dial(mockPeerId);
      expect(dialStub.calledOnce).to.be.true;

      dialStub.resetHistory();

      clock.tick(5000);
      await dialer.dial(mockPeerId);

      expect(dialStub.called).to.be.false;
    });

    it("should skip peer when failed to dial recently", async () => {
      const dialStub = libp2p.dial as sinon.SinonStub;
      dialStub.rejects(new Error("Dial failed"));

      await dialer.dial(mockPeerId);
      expect(dialStub.calledOnce).to.be.true;

      dialStub.resetHistory();
      dialStub.resolves();

      clock.tick(30000);

      await dialer.dial(mockPeerId);
      expect(dialStub.called).to.be.false;
    });

    it("should populate queue if has active dial", async () => {
      const dialStub = libp2p.dial as sinon.SinonStub;
      const mockPeerId3 = createMockPeerId("12D3KooWTest3");

      let resolveFirstDial: () => void;
      const firstDialPromise = new Promise<void>((resolve) => {
        resolveFirstDial = resolve;
      });
      dialStub.onFirstCall().returns(firstDialPromise);
      dialStub.onSecondCall().resolves();
      dialStub.onThirdCall().resolves();

      const firstDialCall = dialer.dial(mockPeerId);

      await dialer.dial(mockPeerId2);
      await dialer.dial(mockPeerId3);

      expect(dialStub.calledOnce).to.be.true;
      expect(dialStub.calledWith(mockPeerId)).to.be.true;

      resolveFirstDial!();
      await firstDialCall;

      clock.tick(500);
      await Promise.resolve();

      expect(dialStub.callCount).to.equal(3);
      expect(dialStub.calledWith(mockPeerId2)).to.be.true;
      expect(dialStub.calledWith(mockPeerId3)).to.be.true;
    });

    it("should allow redial after cooldown period", async () => {
      const dialStub = libp2p.dial as sinon.SinonStub;
      dialStub.resolves();

      await dialer.dial(mockPeerId);
      expect(dialStub.calledOnce).to.be.true;

      clock.tick(10001);
      await dialer.dial(mockPeerId);
      expect(dialStub.calledTwice).to.be.true;
    });

    it("should skip peer when not on same cluster", async () => {
      mockShardReader.hasShardInfo.resolves(true);
      mockShardReader.isPeerOnCluster.resolves(false);

      const dialStub = libp2p.dial as sinon.SinonStub;

      await dialer.dial(mockPeerId);

      expect(dialStub.called).to.be.false;
      expect(mockShardReader.hasShardInfo.calledWith(mockPeerId)).to.be.true;
      expect(mockShardReader.isPeerOnCluster.calledWith(mockPeerId)).to.be.true;
    });

    it("should dial peer when on same shard", async () => {
      mockShardReader.hasShardInfo.resolves(true);
      mockShardReader.isPeerOnCluster.resolves(true);

      const dialStub = libp2p.dial as sinon.SinonStub;
      dialStub.resolves();

      await dialer.dial(mockPeerId);

      expect(dialStub.calledOnce).to.be.true;
      expect(dialStub.calledWith(mockPeerId)).to.be.true;
      expect(mockShardReader.hasShardInfo.calledWith(mockPeerId)).to.be.true;
      expect(mockShardReader.isPeerOnCluster.calledWith(mockPeerId)).to.be.true;
    });

    it("should dial peer when no shard info available", async () => {
      mockShardReader.hasShardInfo.resolves(false);

      const dialStub = libp2p.dial as sinon.SinonStub;
      dialStub.resolves();

      await dialer.dial(mockPeerId);

      expect(dialStub.calledOnce).to.be.true;
      expect(dialStub.calledWith(mockPeerId)).to.be.true;
      expect(mockShardReader.hasShardInfo.calledWith(mockPeerId)).to.be.true;
      expect(mockShardReader.isPeerOnCluster.called).to.be.false;
    });

    it("should handle dial errors gracefully", async () => {
      const dialStub = libp2p.dial as sinon.SinonStub;
      dialStub.rejects(new Error("Dial failed"));

      await dialer.dial(mockPeerId);

      expect(dialStub.calledOnce).to.be.true;
      expect(dialStub.calledWith(mockPeerId)).to.be.true;
    });

    it("should allow redial after failed dial cooldown expires", async () => {
      const dialStub = libp2p.dial as sinon.SinonStub;
      dialStub.onFirstCall().rejects(new Error("Dial failed"));
      dialStub.onSecondCall().resolves();
      await dialer.dial(mockPeerId);
      expect(dialStub.calledOnce).to.be.true;
      clock.tick(60001);
      await dialer.dial(mockPeerId);
      expect(dialStub.calledTwice).to.be.true;
    });

    it("should handle queue overflow by adding peers to queue", async () => {
      const dialStub = libp2p.dial as sinon.SinonStub;
      const peers = [];
      for (let i = 0; i < 100; i++) {
        peers.push(createMockPeerId(`12D3KooWTest${i}`));
      }
      let resolveFirstDial: () => void;
      const firstDialPromise = new Promise<void>((resolve) => {
        resolveFirstDial = resolve;
      });
      dialStub.onFirstCall().returns(firstDialPromise);
      dialStub.resolves();
      const firstDialCall = dialer.dial(peers[0]);
      for (let i = 1; i < 100; i++) {
        await dialer.dial(peers[i]);
      }
      expect(dialStub.calledOnce).to.be.true;
      resolveFirstDial!();
      await firstDialCall;
      clock.tick(500);
      await Promise.resolve();
      expect(dialStub.callCount).to.be.greaterThan(1);
    });
  });

  describe("queue processing", () => {
    beforeEach(() => {
      dialer = new Dialer({
        libp2p,
        shardReader: mockShardReader,
        options: mockOptions
      });
      dialer.start();
    });

    it("should process queue every 500ms", async () => {
      const dialStub = libp2p.dial as sinon.SinonStub;
      dialStub.resolves();

      await dialer.dial(mockPeerId);
      expect(dialStub.calledOnce).to.be.true;
      expect(dialStub.calledWith(mockPeerId)).to.be.true;

      dialStub.resetHistory();
      await dialer.dial(mockPeerId2);
      expect(dialStub.calledOnce).to.be.true;
      expect(dialStub.calledWith(mockPeerId2)).to.be.true;
    });

    it("should process up to 3 peers at once", async () => {
      const dialStub = libp2p.dial as sinon.SinonStub;
      const mockPeerId3 = createMockPeerId("12D3KooWTest3");
      const mockPeerId4 = createMockPeerId("12D3KooWTest4");
      const mockPeerId5 = createMockPeerId("12D3KooWTest5");

      dialStub.resolves();

      await dialer.dial(mockPeerId);
      await dialer.dial(mockPeerId2);
      await dialer.dial(mockPeerId3);
      await dialer.dial(mockPeerId4);
      await dialer.dial(mockPeerId5);

      expect(dialStub.callCount).to.equal(5);
      expect(dialStub.calledWith(mockPeerId)).to.be.true;
      expect(dialStub.calledWith(mockPeerId2)).to.be.true;
      expect(dialStub.calledWith(mockPeerId3)).to.be.true;
      expect(dialStub.calledWith(mockPeerId4)).to.be.true;
      expect(dialStub.calledWith(mockPeerId5)).to.be.true;
    });

    it("should not process empty queue", () => {
      const dialStub = libp2p.dial as sinon.SinonStub;

      clock.tick(500);

      expect(dialStub.called).to.be.false;
    });

    it("should handle queue processing errors gracefully", async () => {
      const dialStub = libp2p.dial as sinon.SinonStub;

      let resolveFirstDial: () => void;
      const firstDialPromise = new Promise<void>((resolve) => {
        resolveFirstDial = resolve;
      });
      dialStub.onFirstCall().returns(firstDialPromise);
      dialStub.onSecondCall().rejects(new Error("Queue dial failed"));

      const firstDialPromise2 = dialer.dial(mockPeerId);
      await dialer.dial(mockPeerId2);

      resolveFirstDial!();
      await firstDialPromise2;

      clock.tick(500);
      await Promise.resolve();

      expect(dialStub.calledTwice).to.be.true;
    });
  });

  describe("shard reader integration", () => {
    beforeEach(() => {
      dialer = new Dialer({
        libp2p,
        shardReader: mockShardReader,
        options: mockOptions
      });
      dialer.start();
    });

    it("should handle shard reader errors gracefully", async () => {
      mockShardReader.hasShardInfo.rejects(new Error("Shard reader error"));

      const dialStub = libp2p.dial as sinon.SinonStub;

      await dialer.dial(mockPeerId);

      expect(dialStub.called).to.be.false;
      expect(mockShardReader.hasShardInfo.calledWith(mockPeerId)).to.be.true;
    });

    it("should handle network check errors gracefully", async () => {
      mockShardReader.hasShardInfo.resolves(true);
      mockShardReader.isPeerOnCluster.rejects(new Error("Network check error"));

      const dialStub = libp2p.dial as sinon.SinonStub;

      await dialer.dial(mockPeerId);

      expect(dialStub.called).to.be.false;
      expect(mockShardReader.hasShardInfo.calledWith(mockPeerId)).to.be.true;
      expect(mockShardReader.isPeerOnCluster.calledWith(mockPeerId)).to.be.true;
    });
  });

  describe("integration", () => {
    it("should handle complete dial lifecycle", async () => {
      dialer = new Dialer({
        libp2p,
        shardReader: mockShardReader,
        options: mockOptions
      });
      dialer.start();

      const dialStub = libp2p.dial as sinon.SinonStub;
      dialStub.resolves();

      await dialer.dial(mockPeerId);

      expect(dialStub.calledOnce).to.be.true;
      expect(dialStub.calledWith(mockPeerId)).to.be.true;

      dialer.stop();
    });

    it("should handle multiple peers with different shard configurations", async () => {
      dialer = new Dialer({
        libp2p,
        shardReader: mockShardReader,
        options: mockOptions
      });
      dialer.start();

      const dialStub = libp2p.dial as sinon.SinonStub;
      dialStub.resolves();

      mockShardReader.hasShardInfo.withArgs(mockPeerId).resolves(true);
      mockShardReader.isPeerOnCluster.withArgs(mockPeerId).resolves(true);

      mockShardReader.hasShardInfo.withArgs(mockPeerId2).resolves(false);

      await dialer.dial(mockPeerId);
      await dialer.dial(mockPeerId2);

      expect(dialStub.calledTwice).to.be.true;
      expect(dialStub.calledWith(mockPeerId)).to.be.true;
      expect(dialStub.calledWith(mockPeerId2)).to.be.true;

      dialer.stop();
    });
  });
});
