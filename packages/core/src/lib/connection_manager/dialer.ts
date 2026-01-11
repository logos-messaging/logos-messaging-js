import type { PeerId } from "@libp2p/interface";
import { ConnectionManagerOptions, Libp2p } from "@waku/interfaces";
import { Logger } from "@waku/utils";

import { ShardReader } from "./shard_reader.js";

const log = new Logger("dialer");

type DialerConstructorOptions = {
  libp2p: Libp2p;
  shardReader: ShardReader;
  options: ConnectionManagerOptions;
};

interface IDialer {
  start(): void;
  stop(): void;
  dial(peerId: PeerId): Promise<void>;
}

export class Dialer implements IDialer {
  private readonly libp2p: Libp2p;
  private readonly shardReader: ShardReader;
  private readonly options: ConnectionManagerOptions;

  private dialingQueue: Map<string, PeerId> = new Map();
  private dialHistory: Map<string, number> = new Map();
  private failedDials: Map<string, number> = new Map();
  private dialingInterval: NodeJS.Timeout | null = null;

  private isProcessing = false;
  private isImmediateDialing = false;

  public constructor(options: DialerConstructorOptions) {
    this.libp2p = options.libp2p;
    this.shardReader = options.shardReader;
    this.options = options.options;
  }

  public start(): void {
    log.info("Starting dialer");

    if (!this.dialingInterval) {
      this.dialingInterval = setInterval(() => {
        void this.processQueue();
      }, 500);
    }

    this.dialHistory.clear();
    this.failedDials.clear();
  }

  public stop(): void {
    log.info("Stopping dialer");

    if (this.dialingInterval) {
      clearInterval(this.dialingInterval);
      this.dialingInterval = null;
    }

    this.dialHistory.clear();
    this.failedDials.clear();
  }

  public async dial(peerId: PeerId): Promise<void> {
    const shouldSkip = await this.shouldSkipPeer(peerId);

    if (shouldSkip) {
      log.info(`Skipping peer: ${peerId}`);
      return;
    }

    const isEmptyQueue = this.dialingQueue.size === 0;
    const isNotDialing = !this.isProcessing && !this.isImmediateDialing;

    // If queue is empty and we're not currently processing, dial immediately
    if (isEmptyQueue && isNotDialing) {
      this.isImmediateDialing = true;
      log.info("Dialed peer immediately");
      await this.dialPeer(peerId);
      this.isImmediateDialing = false;
      log.info("Released immediate dial lock");
    } else {
      this.dialingQueue.set(peerId.toString(), peerId);
      log.info(
        `Added peer to dialing queue, queue size: ${this.dialingQueue.size}`
      );
    }
  }

  private async processQueue(): Promise<void> {
    if (this.dialingQueue.size === 0 || this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      const allPeers = Array.from(this.dialingQueue.values());
      const peersToDial = allPeers.slice(0, this.options.maxDialingPeers);

      peersToDial.forEach((peer) => this.dialingQueue.delete(peer.toString()));

      log.info(
        `Processing dial queue: dialing ${peersToDial.length} peers, ${this.dialingQueue.size} remaining in queue`
      );

      await Promise.all(peersToDial.map((peerId) => this.dialPeer(peerId)));
    } finally {
      this.isProcessing = false;
    }
  }

  private async dialPeer(peerId: PeerId): Promise<void> {
    try {
      log.info(`Dialing peer from queue: ${peerId}`);

      await Promise.race([
        this.libp2p.dial(peerId),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`Dial timeout after ${this.options.dialTimeout}s`)
              ),
            this.options.dialTimeout * 1000
          )
        )
      ]);

      this.dialHistory.set(peerId.toString(), Date.now());
      this.failedDials.delete(peerId.toString());

      log.info(`Successfully dialed peer from queue: ${peerId}`);
    } catch (error) {
      log.error(`Error dialing peer ${peerId}`, error);
      this.failedDials.set(peerId.toString(), Date.now());
    }
  }

  private async shouldSkipPeer(peerId: PeerId): Promise<boolean> {
    const hasConnection = this.libp2p.getPeers().some((p) => p.equals(peerId));
    if (hasConnection) {
      log.info(`Skipping peer ${peerId} - already connected`);
      return true;
    }

    if (this.isRecentlyDialed(peerId)) {
      log.info(
        `Skipping peer ${peerId} - already dialed in the last 10 seconds`
      );
      return true;
    }

    if (this.isRecentlyFailed(peerId)) {
      log.info(`Skipping peer ${peerId} - recently failed to dial`);
      return true;
    }

    try {
      const hasShardInfo = await this.shardReader.hasShardInfo(peerId);
      if (!hasShardInfo) {
        log.info(`Skipping peer ${peerId} - no shard info`);
        return false;
      }

      const isOnSameCluster = await this.shardReader.isPeerOnCluster(peerId);
      if (!isOnSameCluster) {
        log.info(`Skipping peer ${peerId} - not on same cluster`);
        return true;
      }

      return false;
    } catch (error) {
      log.error(`Error checking shard info for peer ${peerId}`, error);
      return true; // Skip peer when there's an error
    }
  }

  private isRecentlyDialed(peerId: PeerId): boolean {
    const lastDialed = this.dialHistory.get(peerId.toString());
    if (
      lastDialed &&
      Date.now() - lastDialed < this.options.dialCooldown * 1000
    ) {
      return true;
    }

    return false;
  }

  private isRecentlyFailed(peerId: PeerId): boolean {
    const lastFailed = this.failedDials.get(peerId.toString());
    if (
      lastFailed &&
      Date.now() - lastFailed < this.options.failedDialCooldown * 1000
    ) {
      return true;
    }

    return false;
  }
}
