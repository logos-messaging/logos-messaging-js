import { Peer, PeerId } from "@libp2p/interface";
import {
  CONNECTION_LOCKED_TAG,
  ConnectionManagerOptions,
  IWakuEventEmitter,
  Libp2p,
  Libp2pEventHandler,
  Tags,
  WakuEvent
} from "@waku/interfaces";
import { Logger } from "@waku/utils";

import { Dialer } from "./dialer.js";
import { NetworkMonitor } from "./network_monitor.js";
import { isAddressesSupported } from "./utils.js";

const log = new Logger("connection-limiter");

const DEFAULT_CONNECTION_MONITOR_INTERVAL = 5 * 1_000;

type ConnectionLimiterConstructorOptions = {
  libp2p: Libp2p;
  events: IWakuEventEmitter;
  dialer: Dialer;
  networkMonitor: NetworkMonitor;
  options: ConnectionManagerOptions;
};

interface IConnectionLimiter {
  start(): void;
  stop(): void;
}

/**
 * This class is responsible for limiting the number of connections to peers.
 * It also dials all known peers because libp2p might have emitted `peer:discovery` before initialization
 * and listen to `peer:connect` and `peer:disconnect` events to manage connections.
 */
export class ConnectionLimiter implements IConnectionLimiter {
  private readonly libp2p: Libp2p;
  private readonly events: IWakuEventEmitter;
  private readonly networkMonitor: NetworkMonitor;
  private readonly dialer: Dialer;

  private connectionMonitorInterval: NodeJS.Timeout | null = null;
  private readonly options: ConnectionManagerOptions;

  public constructor(options: ConnectionLimiterConstructorOptions) {
    this.libp2p = options.libp2p;
    this.events = options.events;
    this.networkMonitor = options.networkMonitor;
    this.dialer = options.dialer;

    this.options = options.options;

    this.onWakuConnectionEvent = this.onWakuConnectionEvent.bind(this);
    this.onDisconnectedEvent = this.onDisconnectedEvent.bind(this);
  }

  public start(): void {
    // dial all known peers because libp2p might have emitted `peer:discovery` before initialization
    void this.dialPeersFromStore();

    if (
      this.options.enableAutoRecovery &&
      this.connectionMonitorInterval === null
    ) {
      this.connectionMonitorInterval = setInterval(
        () => void this.maintainConnections(),
        DEFAULT_CONNECTION_MONITOR_INTERVAL
      );
    }

    this.events.addEventListener(
      WakuEvent.Connection,
      this.onWakuConnectionEvent
    );

    /**
     * NOTE: Event is not being emitted on closing nor losing a connection.
     * @see https://github.com/libp2p/js-libp2p/issues/939
     * @see https://github.com/logos-messaging/logos-messaging-js/issues/252
     *
     * >This event will be triggered anytime we are disconnected from another peer,
     * >regardless of the circumstances of that disconnection.
     * >If we happen to have multiple connections to a peer,
     * >this event will **only** be triggered when the last connection is closed.
     * @see https://github.com/libp2p/js-libp2p/blob/bad9e8c0ff58d60a78314077720c82ae331cc55b/doc/API.md?plain=1#L2100
     */
    this.libp2p.addEventListener(
      "peer:disconnect",
      this.onDisconnectedEvent as Libp2pEventHandler<PeerId>
    );
  }

  public stop(): void {
    this.events.removeEventListener(
      WakuEvent.Connection,
      this.onWakuConnectionEvent
    );

    this.libp2p.removeEventListener(
      "peer:disconnect",
      this.onDisconnectedEvent as Libp2pEventHandler<PeerId>
    );

    if (this.connectionMonitorInterval) {
      clearInterval(this.connectionMonitorInterval);
      this.connectionMonitorInterval = null;
    }
  }

  private onWakuConnectionEvent(): void {
    if (!this.options.enableAutoRecovery) {
      log.info(`Auto recovery is disabled, skipping`);
      return;
    }

    if (this.networkMonitor.isBrowserConnected()) {
      void this.dialPeersFromStore();
    }
  }

  private async maintainConnections(): Promise<void> {
    await this.maintainConnectionsCount();
    await this.maintainBootstrapConnections();
  }

  private async onDisconnectedEvent(): Promise<void> {
    if (this.libp2p.getConnections().length === 0) {
      log.info(`No connections, dialing peers from store`);
      await this.dialPeersFromStore();
    }
  }

  private async maintainConnectionsCount(): Promise<void> {
    log.info(`Maintaining connections count`);

    const connections = this.libp2p.getConnections();

    if (connections.length <= this.options.maxConnections) {
      log.info(
        `Node has less than max connections ${this.options.maxConnections}, trying to dial more peers`
      );

      const peers = await this.getPrioritizedPeers();

      if (peers.length === 0) {
        log.info(`No peers to dial, skipping`);
        await this.triggerBootstrap();
        return;
      }

      const promises = peers
        .slice(0, this.options.maxConnections - connections.length)
        .map((p) => this.dialer.dial(p.id));

      await Promise.all(promises);

      return;
    }

    log.info(
      `Node has more than max connections ${this.options.maxConnections}, dropping connections`
    );

    try {
      const connectionsToDrop = connections
        .filter((c) => !c.tags.includes(CONNECTION_LOCKED_TAG))
        .slice(this.options.maxConnections);

      if (connectionsToDrop.length === 0) {
        log.info(`No connections to drop, skipping`);
        return;
      }

      const promises = connectionsToDrop.map((c) =>
        this.libp2p.hangUp(c.remotePeer)
      );
      await Promise.all(promises);

      log.info(`Dropped ${connectionsToDrop.length} connections`);
    } catch (error) {
      log.error(`Unexpected error while maintaining connections`, error);
    }
  }

  private async maintainBootstrapConnections(): Promise<void> {
    log.info(`Maintaining bootstrap connections`);

    const bootstrapPeers = await this.getBootstrapPeers();

    if (bootstrapPeers.length <= this.options.maxBootstrapPeers) {
      return;
    }

    try {
      const peersToDrop = bootstrapPeers.slice(this.options.maxBootstrapPeers);

      log.info(
        `Dropping ${peersToDrop.length} bootstrap connections because node has more than max bootstrap connections ${this.options.maxBootstrapPeers}`
      );

      const promises = peersToDrop.map((p) => this.libp2p.hangUp(p.id));
      await Promise.all(promises);

      log.info(`Dropped ${peersToDrop.length} bootstrap connections`);
    } catch (error) {
      log.error(
        `Unexpected error while maintaining bootstrap connections`,
        error
      );
    }
  }

  private async dialPeersFromStore(): Promise<void> {
    log.info(`Dialing peers from store`);

    try {
      const peers = await this.getPrioritizedPeers();

      if (peers.length === 0) {
        log.info(`No peers to dial, skipping`);
        await this.triggerBootstrap();
        return;
      }

      const promises = peers.map((p) => this.dialer.dial(p.id));

      log.info(`Dialing ${peers.length} peers from store`);
      await Promise.all(promises);
      log.info(`Dialed ${promises.length} peers from store`);
    } catch (error) {
      log.error(`Unexpected error while dialing peer store peers`, error);
    }
  }

  /**
   * Returns a list of peers ordered by priority:
   * - bootstrap peers
   * - peers from peer exchange
   * - peers from peer cache (last because we are not sure that locally stored information is up to date)
   */
  private async getPrioritizedPeers(): Promise<Peer[]> {
    const allPeers = await this.libp2p.peerStore.all();
    const allConnections = this.libp2p.getConnections();
    const allConnectionsSet = new Set(
      allConnections.map((c) => c.remotePeer.toString())
    );

    log.info(
      `Found ${allPeers.length} peers in store, and found ${allConnections.length} connections`
    );

    const notConnectedPeers = allPeers.filter(
      (p) =>
        !allConnectionsSet.has(p.id.toString()) &&
        isAddressesSupported(
          this.libp2p,
          p.addresses.map((a) => a.multiaddr)
        )
    );

    const bootstrapPeers = notConnectedPeers.filter((p) =>
      p.tags.has(Tags.BOOTSTRAP)
    );

    const peerExchangePeers = notConnectedPeers.filter((p) =>
      p.tags.has(Tags.PEER_EXCHANGE)
    );

    const localStorePeers = notConnectedPeers.filter((p) =>
      p.tags.has(Tags.PEER_CACHE)
    );

    const restPeers = notConnectedPeers.filter(
      (p) =>
        !p.tags.has(Tags.BOOTSTRAP) &&
        !p.tags.has(Tags.PEER_EXCHANGE) &&
        !p.tags.has(Tags.PEER_CACHE)
    );

    return [
      ...bootstrapPeers,
      ...peerExchangePeers,
      ...localStorePeers,
      ...restPeers
    ];
  }

  private async getBootstrapPeers(): Promise<Peer[]> {
    const peers = await Promise.all(
      this.libp2p
        .getConnections()
        .map((conn) => conn.remotePeer)
        .map((id) => this.getPeer(id))
    );

    return peers.filter(
      (peer) => peer && peer.tags.has(Tags.BOOTSTRAP)
    ) as Peer[];
  }

  private async getPeer(peerId: PeerId): Promise<Peer | null> {
    try {
      return await this.libp2p.peerStore.get(peerId);
    } catch (error) {
      log.error(`Failed to get peer ${peerId}, error: ${error}`);
      return null;
    }
  }

  /**
   * Triggers the bootstrap or peer cache discovery if they are mounted.
   * @returns void
   */
  private async triggerBootstrap(): Promise<void> {
    log.info("Triggering bootstrap discovery");

    const bootstrapComponents = Object.values(this.libp2p.components.components)
      .filter((c) => !!c)
      .filter((c: unknown) =>
        [`@waku/${Tags.BOOTSTRAP}`, `@waku/${Tags.PEER_CACHE}`].includes(
          (c as { [Symbol.toStringTag]: string })?.[Symbol.toStringTag]
        )
      );

    if (bootstrapComponents.length === 0) {
      log.warn("No bootstrap components found to trigger");
      return;
    }

    log.info(
      `Found ${bootstrapComponents.length} bootstrap components, starting them`
    );

    const promises = bootstrapComponents.map(async (component) => {
      try {
        await (component as { stop: () => Promise<void> })?.stop?.();
        await (component as { start: () => Promise<void> })?.start?.();
        log.info("Successfully started bootstrap component");
      } catch (error) {
        log.error("Failed to start bootstrap component", error);
      }
    });

    await Promise.all(promises);
  }
}
