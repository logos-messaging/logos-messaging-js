import type { Peer, PeerId, Stream } from "@libp2p/interface";
import type { MultiaddrInput } from "@multiformats/multiaddr";

import { ShardId } from "./sharding.js";

// Peer tags
export enum Tags {
  BOOTSTRAP = "bootstrap",
  PEER_EXCHANGE = "peer-exchange",
  PEER_CACHE = "peer-cache"
}

// Connection tag
export const CONNECTION_LOCKED_TAG = "locked";

export type ConnectionManagerOptions = {
  /**
   * Max number of bootstrap peers allowed to be connected to initially.
   * This is used to increase intention of dialing non-bootstrap peers, found using other discovery mechanisms (like Peer Exchange).
   *
   * @default 3
   */
  maxBootstrapPeers: number;

  /**
   * Max number of connections allowed to be connected to.
   *
   * @default 10
   */
  maxConnections: number;

  /**
   * Keep alive libp2p pings interval in seconds.
   *
   * @default 300 seconds
   */
  pingKeepAlive: number;

  /**
   * Gossip sub specific keep alive interval in seconds.
   *
   * @default 300 seconds
   */
  relayKeepAlive: number;

  /**
   * Enable auto recovery of connections if has not enough:
   * - bootstrap peers
   * - LightPush and Filter peers
   * - number of connected peers
   * - dial known peers on reconnect to Internet
   *
   * @default true
   */
  enableAutoRecovery: boolean;

  /**
   * Max number of peers to dial at once.
   *
   * @default 3
   */
  maxDialingPeers: number;

  /**
   * Time to wait before dialing failed peers again.
   *
   * @default 60 seconds
   */
  failedDialCooldown: number;

  /**
   * Time to wait before dialing a peer again.
   *
   * @default 10 seconds
   */
  dialCooldown: number;

  /**
   * Time to wait for a dial attempt to complete before timing out.
   *
   * @default 30 seconds
   */
  dialTimeout: number;
};

export interface IConnectionManager {
  /**
   * Starts network monitoring, dialing discovered peers, keep-alive management, and connection limiting.
   *
   * @example
   * ```typescript
   * const connectionManager = new ConnectionManager(options);
   * connectionManager.start();
   * ```
   */
  start(): void;

  /**
   * Stops network monitoring, discovery dialing, keep-alive management, and connection limiting.
   *
   * @example
   * ```typescript
   * connectionManager.stop();
   * ```
   */
  stop(): void;

  /**
   * Connects to a peer using specific protocol codecs.
   * This is a direct proxy to libp2p's dialProtocol method.
   *
   * @param peer - The peer to connect to (PeerId or multiaddr)
   * @param protocolCodecs - Array of protocol codec strings to establish
   * @returns Promise resolving to a Stream connection to the peer
   * @throws Error if the connection cannot be established
   *
   * @example
   * ```typescript
   * const stream = await connectionManager.dial(
   *   peerId,
   *   ["/vac/waku/store/2.0.0-beta4"]
   * );
   * ```
   */
  dial(
    peer: PeerId | MultiaddrInput,
    protocolCodecs: string[]
  ): Promise<Stream>;

  /**
   * Terminates the connection to a specific peer.
   *
   * @param peer - The peer to disconnect from (PeerId or multiaddr)
   * @returns Promise resolving to true if disconnection was successful, false otherwise
   *
   * @example
   * ```typescript
   * const success = await connectionManager.hangUp(peerId);
   * if (success) {
   *   console.log("Peer disconnected successfully");
   * }
   * ```
   */
  hangUp(peer: PeerId | MultiaddrInput): Promise<boolean>;

  /**
   * Retrieves a list of currently connected peers, optionally filtered by protocol codec.
   * Results are sorted by ping time (lowest first).
   *
   * @param codec - Optional protocol codec to filter peers by
   * @returns Promise resolving to an array of connected Peer objects
   *
   * @example
   * ```typescript
   * // Get all connected peers
   * const allPeers = await connectionManager.getConnectedPeers();
   *
   * // Get peers supporting a specific protocol
   * const storePeers = await connectionManager.getConnectedPeers(
   *   "/vac/waku/store/2.0.0-beta4"
   * );
   * ```
   */
  getConnectedPeers(codec?: string): Promise<Peer[]>;

  /**
   * Checks if a peer has shard info.
   *
   * @param peerId - The peer to check
   * @returns Promise resolving to true if the peer has shard info, false otherwise
   */
  hasShardInfo(peerId: PeerId): Promise<boolean>;

  /**
   * Returns true if the passed peer is on the passed pubsub topic
   */
  isPeerOnTopic(peerId: PeerId, pubsubTopic: string): Promise<boolean>;

  /**
   * Returns true if the passed peer is on the passed shard
   */
  isPeerOnShard(peerId: PeerId, shardId: ShardId): Promise<boolean>;
}
