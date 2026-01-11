import { type Peer, type PeerId, type Stream } from "@libp2p/interface";
import { MultiaddrInput } from "@multiformats/multiaddr";
import {
  ConnectionManagerOptions,
  IConnectionManager,
  IRelay,
  IWakuEventEmitter,
  NetworkConfig,
  ShardId
} from "@waku/interfaces";
import { Libp2p } from "@waku/interfaces";
import { Logger } from "@waku/utils";

import { ConnectionLimiter } from "./connection_limiter.js";
import { Dialer } from "./dialer.js";
import { DiscoveryDialer } from "./discovery_dialer.js";
import { KeepAliveManager } from "./keep_alive_manager.js";
import { NetworkMonitor } from "./network_monitor.js";
import { ShardReader } from "./shard_reader.js";
import { getPeerPing, mapToPeerId, mapToPeerIdOrMultiaddr } from "./utils.js";

const log = new Logger("connection-manager");

const DEFAULT_MAX_BOOTSTRAP_PEERS_ALLOWED = 3;
const DEFAULT_PING_KEEP_ALIVE_SEC = 5 * 60;
const DEFAULT_RELAY_KEEP_ALIVE_SEC = 5 * 60;
const DEFAULT_ENABLE_AUTO_RECOVERY = true;
const DEFAULT_MAX_CONNECTIONS = 10;
const DEFAULT_MAX_DIALING_PEERS = 3;
const DEFAULT_FAILED_DIAL_COOLDOWN_SEC = 60;
const DEFAULT_DIAL_COOLDOWN_SEC = 10;
const DEFAULT_DIAL_TIMEOUT_SEC = 30;

type ConnectionManagerConstructorOptions = {
  libp2p: Libp2p;
  events: IWakuEventEmitter;
  networkConfig: NetworkConfig;
  relay?: IRelay;
  config?: Partial<ConnectionManagerOptions>;
};

export class ConnectionManager implements IConnectionManager {
  private readonly keepAliveManager: KeepAliveManager;
  private readonly discoveryDialer: DiscoveryDialer;
  private readonly dialer: Dialer;
  private readonly shardReader: ShardReader;
  private readonly networkMonitor: NetworkMonitor;
  private readonly connectionLimiter: ConnectionLimiter;

  private readonly options: ConnectionManagerOptions;
  private libp2p: Libp2p;

  public constructor(options: ConnectionManagerConstructorOptions) {
    this.libp2p = options.libp2p;

    this.options = {
      maxBootstrapPeers: DEFAULT_MAX_BOOTSTRAP_PEERS_ALLOWED,
      maxConnections: DEFAULT_MAX_CONNECTIONS,
      pingKeepAlive: DEFAULT_PING_KEEP_ALIVE_SEC,
      relayKeepAlive: DEFAULT_RELAY_KEEP_ALIVE_SEC,
      enableAutoRecovery: DEFAULT_ENABLE_AUTO_RECOVERY,
      maxDialingPeers: DEFAULT_MAX_DIALING_PEERS,
      failedDialCooldown: DEFAULT_FAILED_DIAL_COOLDOWN_SEC,
      dialCooldown: DEFAULT_DIAL_COOLDOWN_SEC,
      dialTimeout: DEFAULT_DIAL_TIMEOUT_SEC,
      ...options.config
    };

    this.keepAliveManager = new KeepAliveManager({
      relay: options.relay,
      libp2p: options.libp2p,
      networkConfig: options.networkConfig,
      options: {
        pingKeepAlive: this.options.pingKeepAlive,
        relayKeepAlive: this.options.relayKeepAlive
      }
    });

    this.shardReader = new ShardReader({
      libp2p: options.libp2p,
      networkConfig: options.networkConfig
    });

    this.dialer = new Dialer({
      libp2p: options.libp2p,
      shardReader: this.shardReader,
      options: this.options
    });

    this.discoveryDialer = new DiscoveryDialer({
      libp2p: options.libp2p,
      dialer: this.dialer
    });

    this.networkMonitor = new NetworkMonitor({
      libp2p: options.libp2p,
      events: options.events
    });

    this.connectionLimiter = new ConnectionLimiter({
      libp2p: options.libp2p,
      events: options.events,
      networkMonitor: this.networkMonitor,
      dialer: this.dialer,
      options: this.options
    });
  }

  public start(): void {
    this.dialer.start();
    this.networkMonitor.start();
    this.discoveryDialer.start();
    this.keepAliveManager.start();
    this.connectionLimiter.start();
  }

  public stop(): void {
    this.dialer.stop();
    this.networkMonitor.stop();
    this.discoveryDialer.stop();
    this.keepAliveManager.stop();
    this.connectionLimiter.stop();
  }

  public isConnected(): boolean {
    return this.networkMonitor.isConnected();
  }

  public async dial(
    peer: PeerId | MultiaddrInput,
    protocolCodecs: string[]
  ): Promise<Stream> {
    const ma = mapToPeerIdOrMultiaddr(peer);
    log.info(`Dialing peer ${ma.toString()} with protocols ${protocolCodecs}`);

    // must use libp2p directly instead of dialer because we need to dial the peer right away
    const stream = await this.libp2p.dialProtocol(ma, protocolCodecs);
    log.info(`Dialed peer ${ma.toString()} with protocols ${protocolCodecs}`);

    return stream;
  }

  public async hangUp(peer: PeerId | MultiaddrInput): Promise<boolean> {
    const peerId = mapToPeerId(peer);

    try {
      log.info(`Dropping connection with peer ${peerId.toString()}`);
      await this.libp2p.hangUp(peerId);
      log.info(`Dropped connection with peer ${peerId.toString()}`);

      return true;
    } catch (error) {
      log.error(
        `Error dropping connection with peer ${peerId.toString()} - ${error}`
      );

      return false;
    }
  }

  public async getConnectedPeers(codec?: string): Promise<Peer[]> {
    const peerIDs = this.libp2p.getPeers();

    log.info(`Getting connected peers for codec ${codec}`);

    if (peerIDs.length === 0) {
      log.info(`No connected peers`);
      return [];
    }

    const peers = await Promise.all(
      peerIDs.map(async (id) => {
        try {
          return await this.libp2p.peerStore.get(id);
        } catch (e) {
          return null;
        }
      })
    );

    const result = peers
      .filter((p) => !!p)
      .filter((p) => (codec ? (p as Peer).protocols.includes(codec) : true))
      .sort((left, right) => getPeerPing(left) - getPeerPing(right)) as Peer[];

    log.info(`Found ${result.length} connected peers for codec ${codec}`);

    return result;
  }

  public async hasShardInfo(peerId: PeerId): Promise<boolean> {
    return this.shardReader.hasShardInfo(peerId);
  }

  public async isPeerOnTopic(
    peerId: PeerId,
    pubsubTopic: string
  ): Promise<boolean> {
    return this.shardReader.isPeerOnTopic(peerId, pubsubTopic);
  }

  public async isPeerOnShard(
    peerId: PeerId,
    shardId: ShardId
  ): Promise<boolean> {
    return this.shardReader.isPeerOnShard(peerId, shardId);
  }
}
