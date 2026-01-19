import type {
  Peer,
  PeerId,
  Stream,
  TypedEventEmitter
} from "@libp2p/interface";
import type { MultiaddrInput } from "@multiformats/multiaddr";

import type { IFilter } from "./filter.js";
import type { HealthStatus } from "./health_status.js";
import type { Libp2p } from "./libp2p.js";
import type { ILightPush } from "./light_push.js";
import { IDecodedMessage, IDecoder, IEncoder } from "./message.js";
import type { Protocols } from "./protocols.js";
import type { IRelay } from "./relay.js";
import type { ShardId } from "./sharding.js";
import type { IStore } from "./store.js";

export type CreateDecoderParams = {
  contentTopic: string;
  shardId?: ShardId;
};

export type CreateEncoderParams = CreateDecoderParams & {
  ephemeral?: boolean;
};

export const WakuEvent = {
  Connection: "waku:connection",
  Health: "waku:health"
} as const;

export type WakuEvent = (typeof WakuEvent)[keyof typeof WakuEvent];

export interface IWakuEvents {
  /**
   * Emitted when a connection is established or lost.
   *
   * @example
   * ```typescript
   * waku.events.addEventListener("waku:connection", (event) => {
   *   console.log(event.detail); // true if connected, false if disconnected
   * });
   */
  "waku:connection": CustomEvent<boolean>;

  /**
   * Emitted when the health status changes.
   *
   * @example
   * ```typescript
   * waku.events.addEventListener("waku:health", (event) => {
   *   console.log(event.detail); // 'Unhealthy', 'MinimallyHealthy', or 'SufficientlyHealthy'
   * });
   */
  "waku:health": CustomEvent<HealthStatus>;
}

export type IWakuEventEmitter = TypedEventEmitter<IWakuEvents>;

export interface IWaku {
  libp2p: Libp2p;
  relay?: IRelay;
  store?: IStore;
  filter?: IFilter;
  lightPush?: ILightPush;

  /**
   * Emits events related to the Waku node.
   * Those are:
   * - "waku:connection"
   * - "waku:health"
   *
   * @example
   * ```typescript
   * waku.events.addEventListener("waku:connection", (event) => {
   *   console.log(event.detail); // true if connected, false if disconnected
   * });
   * ```
   */
  events: IWakuEventEmitter;

  /**
   * Returns a unique identifier for a node on the network.
   *
   * @example
   * ```typescript
   * console.log(waku.peerId); // 12D3KooWNmk9yXHfHJ4rUduRqD1TCTHkNFMPF9WP2dqWpZDL4aUb
   * ```
   */
  peerId: PeerId;

  /**
   * The health status can be one of three states:
   * - Unhealthy: No peer connections
   * - MinimallyHealthy: At least 1 peer supporting both Filter and LightPush protocols
   * - SufficientlyHealthy: At least 2 peers supporting both Filter and LightPush protocols
   *
   * @example
   * ```typescript
   * console.log(waku.health); // 'Unhealthy'
   * ```
   */
  health: HealthStatus;

  /**
   * Returns a list of supported protocols.
   *
   * @example
   * ```typescript
   * console.log(waku.protocols); // ['/ipfs/id/1.0.0', '/ipfs/ping/1.0.0', '/vac/waku/filter-push/2.0.0-beta1', '/vac/waku/metadata/1.0.0']
   * ```
   */
  protocols: string[];

  /**
   * Dials to the provided peer
   *
   * @param {PeerId | MultiaddrInput} peer information to use for dialing
   * @param {Protocols[]} [protocols] array of Waku protocols to be used for dialing. If no provided - will be derived from mounted protocols.
   *
   * @returns {Promise<Stream>} `Promise` that will resolve to a `Stream` to a dialed peer and will reject if the connection fails
   *
   * @example
   * ```typescript
   * await waku.dial(remotePeerId, [Protocols.LightPush]);
   *
   * waku.isConnected() === true;
   * ```
   */
  dial(peer: PeerId | MultiaddrInput, protocols?: Protocols[]): Promise<Stream>;

  /**
   * Hang up a connection to a peer
   *
   * @param {PeerId | MultiaddrInput} peer information to use for hanging up
   *
   * @returns {Promise<boolean>} `Promise` that will resolve to `true` if the connection is hung up, `false` otherwise
   */
  hangUp(peer: PeerId | MultiaddrInput): Promise<boolean>;

  /**
   * Starts all services and components related to functionality of Waku node.
   *
   * @returns {Promise<boolean>} `Promise` that will resolve when started.
   *
   * @example
   * ```typescript
   * await waku.start();
   *
   * waku.isStarted() === true;
   * ```
   */
  start(): Promise<void>;

  /**
   * Stops all recurring processes and services that are needed for functionality of Waku node.
   *
   * @returns {Promise<boolean>} `Promise` that resolves when stopped.
   *
   * @example
   * ```typescript
   * await waku.stop();
   *
   * waku.isStarted === false;
   * ```
   */
  stop(): Promise<void>;

  /**
   * Resolves when Waku successfully gains connection to a remote peers that fits provided requirements.
   * Must be used after attempting to connect to nodes, using {@link IWaku.dial} or
   * if was bootstrapped by using {@link IPeerExchange} or {@link DnsDiscoveryComponents}.
   *
   * @param {Protocols[]} [protocols] Protocols that need to be enabled by remote peers
   * @param {number} [timeoutMs] Timeout value in milliseconds after which promise rejects
   *
   * @returns {Promise<void>} `Promise` that **resolves** if all desired protocols are fulfilled by
   * at least one remote peer, **rejects** if the timeoutMs is reached
   * @throws If passing a protocol that is not mounted or Waku node is not started
   *
   * @example
   * ```typescript
   * try {
   *  // let's wait for at least one LightPush node and timeout in 1 second
   *  await waku.waitForPeers([Protocols.LightPush], 1000);
   * } catch(e) {
   *  waku.isConnected() === false;
   *  console.error("Failed to connect due to", e);
   * }
   *
   * waku.isConnected() === true;
   * ```
   */
  waitForPeers(protocols?: Protocols[], timeoutMs?: number): Promise<void>;

  /**
   * Creates a decoder for Waku messages on a specific content topic.
   *
   * A decoder is used to decode messages from the Waku network format.
   * The decoder automatically handles shard configuration based on the Waku node's network settings.
   *
   * @param {CreateDecoderParams} params - Configuration for the decoder
   * @returns {IDecoder<IDecodedMessage>} A decoder instance configured for the specified content topic
   * @throws {Error} If the shard configuration is incompatible with the node's network settings
   *
   * @example
   * ```typescript
   * // Create a decoder with default network shard settings
   * const decoder = waku.createDecoder({
   *   contentTopic: "/my-app/1/chat/proto"
   * });
   *
   * // Create a decoder with custom shard settings
   * const customDecoder = waku.createDecoder({
   *   contentTopic: "/my-app/1/chat/proto",
   *   shardInfo: {
   *     clusterId: 1,
   *     shard: 5
   *   }
   * });
   * ```
   */
  createDecoder(params: CreateDecoderParams): IDecoder<IDecodedMessage>;

  /**
   * Creates an encoder for Waku messages on a specific content topic.
   *
   * An encoder is used to encode messages into the Waku network format.
   * The encoder automatically handles shard configuration based on the Waku node's network settings.
   *
   * @param {CreateEncoderParams} params - Configuration for the encoder including content topic and optionally shard information and ephemeral flag
   * @returns {IEncoder} An encoder instance configured for the specified content topic
   * @throws {Error} If the shard configuration is incompatible with the node's network settings
   *
   * @example
   * ```typescript
   * // Create a basic encoder with default network shard settings
   * const encoder = waku.createEncoder({
   *   contentTopic: "/my-app/1/chat/proto"
   * });
   *
   * // Create an ephemeral encoder (messages won't be stored by store nodes)
   * const ephemeralEncoder = waku.createEncoder({
   *   contentTopic: "/my-app/1/notifications/proto",
   *   ephemeral: true,
   *   shardInfo: {
   *     clusterId: 2,
   *     shardsUnderCluster: 16
   *   }
   * });
   * ```
   */
  createEncoder(params: CreateEncoderParams): IEncoder;

  /**
   * @returns {boolean} `true` if the node was started and `false` otherwise
   */
  isStarted(): boolean;

  /**
   * @returns {boolean} `true` if the node has working connection and `false` otherwise
   */
  isConnected(): boolean;

  /**
   * @returns {Peer[]} an array of all connected peers
   */
  getConnectedPeers(): Promise<Peer[]>;
}

export interface LightNode extends IWaku {
  relay: undefined;
  store: IStore;
  filter: IFilter;
  lightPush: ILightPush;
}

export interface RelayNode extends IWaku {
  relay: IRelay;
  store: undefined;
  filter: undefined;
  lightPush: undefined;
}
