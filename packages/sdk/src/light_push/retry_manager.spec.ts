import type { PeerId } from "@libp2p/interface";
import {
  type LightPushCoreResult,
  LightPushError,
  ProtocolError,
  Protocols
} from "@waku/interfaces";
import { createRoutingInfo } from "@waku/utils";
import { expect } from "chai";
import sinon from "sinon";

import { PeerManager } from "../peer_manager/index.js";

import { RetryManager, ScheduledTask } from "./retry_manager.js";

const TestRoutingInfo = createRoutingInfo(
  { clusterId: 0 },
  { pubsubTopic: "/waku/2/rs/0/0" }
);

describe("RetryManager", () => {
  let retryManager: RetryManager;
  let peerManager: PeerManager;
  let mockPeerId: PeerId;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers();

    mockPeerId = { toString: () => "test-peer-id" } as PeerId;
    peerManager = {
      getPeers: () => [mockPeerId],
      renewPeer: sinon.spy(),
      start: sinon.spy(),
      stop: sinon.spy()
    } as unknown as PeerManager;

    retryManager = new RetryManager({
      peerManager,
      retryIntervalMs: 100
    });
  });

  afterEach(() => {
    clock.restore();
    retryManager.stop();
    sinon.restore();
  });

  // TODO: Skipped because the global state is not being restored and it breaks
  // tests of functionalities that rely on intervals
  it.skip("should start and stop interval correctly", () => {
    const setIntervalSpy = sinon.spy(global, "setInterval");
    const clearIntervalSpy = sinon.spy(global, "clearInterval");

    retryManager.start();
    expect(setIntervalSpy.calledOnce).to.be.true;

    retryManager.stop();
    expect(clearIntervalSpy.calledOnce).to.be.true;
  });

  it("should process tasks in queue", async () => {
    const successCallback = sinon.spy(
      async (peerId: PeerId): Promise<LightPushCoreResult> => ({
        success: peerId,
        failure: null
      })
    );

    retryManager.push(successCallback, 3, TestRoutingInfo);
    retryManager.start();

    await clock.tickAsync(200);
    retryManager.stop();

    expect(successCallback.calledOnce, "called").to.be.true;
    expect(successCallback.calledWith(mockPeerId), "called with peer").to.be
      .true;
  });

  it("should requeue task if no peer is available", async () => {
    (peerManager as any).getPeers = () => [];
    const callback = sinon.spy();

    retryManager.push(callback, 2, TestRoutingInfo);
    retryManager.start();

    const queue = (retryManager as any)["queue"] as ScheduledTask[];
    expect(queue.length).to.equal(1);

    await clock.tickAsync(200);
    retryManager.stop();

    expect(callback.called).to.be.false;
    expect(queue.length).to.equal(1);
    expect(queue[0].maxAttempts).to.equal(1);
  });

  it("should not requeue if maxAttempts is exhausted and no peer is available", async () => {
    (peerManager as any).getPeers = () => [];
    const callback = sinon.spy();

    retryManager.push(callback, 1, TestRoutingInfo);
    retryManager.start();
    const queue = (retryManager as any)["queue"] as ScheduledTask[];
    expect(queue.length).to.equal(1);

    await clock.tickAsync(500);
    retryManager.stop();

    expect(callback.called).to.be.false;
    expect(queue.length).to.equal(0);
  });

  it("should retry failed tasks", async () => {
    const failingCallback = sinon.spy(
      async (): Promise<LightPushCoreResult> => ({
        success: null,
        failure: { error: LightPushError.GENERIC_FAIL }
      })
    );

    const queue = (retryManager as any)["queue"] as ScheduledTask[];

    const task = {
      callback: failingCallback,
      maxAttempts: 2,
      routingInfo: TestRoutingInfo
    };
    await (retryManager as any)["taskExecutor"](task);

    expect(failingCallback.calledOnce, "executed callback").to.be.true;
    expect(
      queue.some((t) => t.maxAttempts === 1),
      "task attempt decreased"
    ).to.be.true;
  });

  it("should request peer renewal on specific errors", async () => {
    const errorCallback = sinon.spy(async (): Promise<LightPushCoreResult> => {
      throw new Error(ProtocolError.NO_PEER_AVAILABLE);
    });

    await (retryManager as RetryManager)["taskExecutor"]({
      callback: errorCallback,
      maxAttempts: 1,
      routingInfo: TestRoutingInfo
    });

    expect((peerManager.renewPeer as sinon.SinonSpy).calledOnce).to.be.true;
    expect(
      (peerManager.renewPeer as sinon.SinonSpy).calledWith(mockPeerId, {
        protocol: Protocols.LightPush,
        pubsubTopic: TestRoutingInfo.pubsubTopic
      })
    ).to.be.true;
  });

  it("should handle task timeouts", async () => {
    const slowCallback = sinon.spy(async (): Promise<LightPushCoreResult> => {
      await new Promise((resolve) => setTimeout(resolve, 15000));
      return { success: mockPeerId, failure: null };
    });

    const task = {
      callback: slowCallback,
      maxAttempts: 1,
      routingInfo: TestRoutingInfo
    };
    const executionPromise = (retryManager as any)["taskExecutor"](task);

    await clock.tickAsync(11000);
    await executionPromise;

    expect(slowCallback.calledOnce).to.be.true;
  });

  it("should not execute task if max attempts is 0", async () => {
    const failingCallback = sinon.spy(
      async (): Promise<LightPushCoreResult> => {
        throw new Error("test error" as any);
      }
    );

    const task = {
      callback: failingCallback,
      maxAttempts: 0,
      routingInfo: TestRoutingInfo
    };
    await (retryManager as any)["taskExecutor"](task);

    expect(failingCallback.called).to.be.false;
  });

  it("should not retry if at least one success", async () => {
    let called = 0;
    (peerManager as any).getPeers = () => [mockPeerId];
    const successCallback = sinon.stub().callsFake(() => {
      called++;
      if (called === 1) retryManager.stop();
      return Promise.resolve({ success: mockPeerId, failure: null });
    });
    retryManager.push(successCallback, 2, TestRoutingInfo);
    retryManager.start();
    await clock.tickAsync(500);
    expect(called).to.equal(1);
  });

  it("should retry if all attempts fail", async () => {
    let called = 0;
    (peerManager as any).getPeers = () => [mockPeerId];
    const failCallback = sinon.stub().callsFake(() => {
      called++;
      return Promise.resolve({
        success: null,
        failure: { error: LightPushError.GENERIC_FAIL }
      });
    });
    retryManager.push(failCallback, 2, TestRoutingInfo);
    retryManager.start();
    await clock.tickAsync(1000);
    retryManager.stop();
    expect(called).to.be.greaterThan(1);
    const queue = (retryManager as any)["queue"] as ScheduledTask[];
    expect(queue.length).to.equal(0);
  });
});
