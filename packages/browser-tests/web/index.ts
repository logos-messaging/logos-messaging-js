import {
  createLightNode,
  LightNode,
  Protocols,
  NetworkConfig,
  CreateNodeOptions,
} from "@waku/sdk";
import {
  AutoSharding,
  DEFAULT_CLUSTER_ID,
  DEFAULT_NUM_SHARDS,
  ShardId,
  StaticSharding,
  ShardInfo,
  CreateLibp2pOptions,
  IEncoder,
  ILightPush,
  IMessage,
} from "@waku/interfaces";
import { bootstrap } from "@libp2p/bootstrap";
import { EnrDecoder, TransportProtocol } from "@waku/enr";
import type { Multiaddr } from "@multiformats/multiaddr";
import type { ITestBrowser } from "../types/global.js";
import { Logger, StaticShardingRoutingInfo } from "@waku/utils";
import type { PeerId } from "@libp2p/interface";
import { messageHashStr } from "@waku/core";

const log = new Logger("waku-headless");

export interface SerializableSDKProtocolResult {
  successes: string[];
  failures: Array<{
    error: string;
    peerId?: string;
  }>;
  myPeerId?: string;
  messageHash?: string;
  timestamp?: number;
}

function makeSerializable(result: { successes: PeerId[], failures: Array<{ error: any, peerId?: PeerId }> }): SerializableSDKProtocolResult {
  return {
    ...result,
    successes: result.successes.map((peerId: PeerId) => peerId.toString()),
    failures: result.failures.map((failure) => ({
      error: String(failure.error),
      peerId: failure.peerId ? failure.peerId.toString() : undefined,
    })),
  };
}

async function convertEnrToMultiaddrs(enrString: string): Promise<string[]> {
  try {
    const enr = await EnrDecoder.fromString(enrString);
    const allMultiaddrs = enr.getAllLocationMultiaddrs();
    const multiaddrs: string[] = [];

    for (const multiaddr of allMultiaddrs) {
      const maStr = multiaddr.toString();
      multiaddrs.push(maStr);
    }
    if (multiaddrs.length === 0) {
      const tcpMultiaddr = enr.getFullMultiaddr(TransportProtocol.TCP);
      if (tcpMultiaddr) {
        const tcpStr = tcpMultiaddr.toString();
        multiaddrs.push(tcpStr);
      }
      const udpMultiaddr = enr.getFullMultiaddr(TransportProtocol.UDP);
      if (udpMultiaddr) {
        const udpStr = udpMultiaddr.toString();
        multiaddrs.push(udpStr);
      }
    }

    return multiaddrs;
  } catch (error) {
    return [];
  }
}

export class WakuHeadless {
  waku: LightNode | null;
  networkConfig: NetworkConfig;
  lightpushNode: string | null;
  enrBootstrap: string | null;
  constructor(
    networkConfig?: Partial<NetworkConfig>,
    lightpushNode?: string | null,
    enrBootstrap?: string | null,
  ) {
    this.waku = null;
    this.networkConfig = this.buildNetworkConfig(networkConfig);
    log.info("Network config on construction:", this.networkConfig);
    this.lightpushNode = lightpushNode || null;
    this.enrBootstrap = enrBootstrap || null;

    if (this.lightpushNode) {
      log.info(`Configured preferred lightpush node: ${this.lightpushNode}`);
    }
    if (this.enrBootstrap) {
      log.info(`Configured ENR bootstrap: ${this.enrBootstrap}`);
    }
  }

  private shouldUseCustomBootstrap(options: CreateNodeOptions): boolean {
    const hasEnr = Boolean(this.enrBootstrap);
    const isDefaultBootstrap = Boolean(options.defaultBootstrap);

    return hasEnr && !isDefaultBootstrap;
  }

  private async getBootstrapMultiaddrs(): Promise<string[]> {
    if (!this.enrBootstrap) {
      return [];
    }

    const enrList = this.enrBootstrap.split(",").map((enr) => enr.trim());
    const allMultiaddrs: string[] = [];

    for (const enr of enrList) {
      const multiaddrs = await convertEnrToMultiaddrs(enr);
      if (multiaddrs.length > 0) {
        allMultiaddrs.push(...multiaddrs);
      }
    }

    return allMultiaddrs;
  }

  private buildNetworkConfig(
    providedConfig?: Partial<NetworkConfig> | Partial<ShardInfo>,
  ): NetworkConfig {
    const clusterId = providedConfig?.clusterId ?? DEFAULT_CLUSTER_ID;

    const staticShards = (providedConfig as Partial<ShardInfo>)?.shards;
    if (
      staticShards &&
      Array.isArray(staticShards) &&
      staticShards.length > 0
    ) {
      log.info("Using static sharding with shards:", staticShards);
      return {
        clusterId,
      } as StaticSharding;
    }

    const numShardsInCluster =
      (providedConfig as Partial<AutoSharding>)?.numShardsInCluster ?? DEFAULT_NUM_SHARDS;
    log.info(
      "Using auto sharding with num shards in cluster:",
      numShardsInCluster,
    );
    return {
      clusterId,
      numShardsInCluster,
    } as AutoSharding;
  }

  private async send(
    lightPush: ILightPush,
    encoder: IEncoder,
    message: IMessage,
  ) {
    return lightPush.send(encoder, message);
  }

  async pushMessageV3(
    contentTopic: string,
    payload: string,
    pubsubTopic: string,
  ): Promise<SerializableSDKProtocolResult> {
    if (!this.waku) {
      throw new Error("Waku node not started");
    }
    log.info(
      "Pushing message via v3 lightpush:",
      contentTopic,
      payload,
      pubsubTopic,
    );
    log.info("Waku node:", this.waku);
    log.info("Network config:", this.networkConfig);

    let processedPayload: Uint8Array;
    try {
      const binaryString = atob(payload);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      processedPayload = bytes;
    } catch (e) {
      processedPayload = new TextEncoder().encode(payload);
    }

    const message: IMessage = {
      payload: processedPayload,
      timestamp: new Date(),
    };

    try {
      const lightPush = this.waku.lightPush;
      if (!lightPush) {
        throw new Error("Lightpush service not available");
      }

      let shardId: ShardId | undefined;
      if (pubsubTopic) {
        const staticShardingRoutingInfo =
          StaticShardingRoutingInfo.fromPubsubTopic(
            pubsubTopic,
            this.networkConfig as StaticSharding,
          );
        shardId = staticShardingRoutingInfo?.shardId;
      }

      const encoder = this.waku.createEncoder({
        contentTopic,
        shardId,
      });
      log.info("Encoder:", encoder);
      log.info("Pubsub topic:", pubsubTopic);
      log.info("Encoder pubsub topic:", encoder.pubsubTopic);

      const protoObj = await encoder.toProtoObj(message);
      if (!protoObj) {
        throw new Error("Failed to convert message to proto object");
      }

      if (pubsubTopic && pubsubTopic !== encoder.pubsubTopic) {
        log.warn(
          `Explicit pubsubTopic ${pubsubTopic} provided, but auto-sharding determined ${encoder.pubsubTopic}. Using auto-sharding.`,
        );
      }

      let result;
      if (this.lightpushNode) {
        try {
          const preferredPeerId = this.getPeerIdFromMultiaddr(
            this.lightpushNode,
          );
          if (preferredPeerId) {
            result = await this.send(lightPush, encoder, message);
            log.info("✅ Message sent via preferred lightpush node");
          } else {
            throw new Error(
              "Could not extract peer ID from preferred node address",
            );
          }
        } catch (error) {
          log.error(
            "Couldn't send message via preferred lightpush node:",
            error,
          );
          result = await this.send(lightPush, encoder, message);
        }
      } else {
        result = await this.send(lightPush, encoder, message);
      }

      let serializableResult = makeSerializable(result);

      serializableResult.myPeerId = this.waku.libp2p.peerId.toString();

      const messageHash = '0x' + messageHashStr(
        encoder.pubsubTopic,
        protoObj,
      );

      serializableResult.messageHash = messageHash;

      return serializableResult;
    } catch (error) {
      log.error("Error sending message via v3 lightpush:", error);
      throw new Error(
        `Failed to send v3 message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async waitForPeers(
    timeoutMs: number = 10000,
    protocols: Protocols[] = [Protocols.LightPush, Protocols.Filter],
  ) {
    if (!this.waku) {
      throw new Error("Waku node not started");
    }

    const startTime = Date.now();

    try {
      await this.waku.waitForPeers(protocols, timeoutMs);
      const elapsed = Date.now() - startTime;

      const peers = this.waku.libp2p.getPeers();

      return {
        success: true,
        peersFound: peers.length,
        protocolsRequested: protocols,
        timeElapsed: elapsed,
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      log.error(`Failed to find peers after ${elapsed}ms:`, error);
      throw error;
    }
  }

  async createWakuNode(options: CreateNodeOptions) {
    try {
      if (this.waku) {
        await this.waku.stop();
      }
    } catch (e) {
      log.warn("ignore previous waku stop error");
    }

    let libp2pConfig: CreateLibp2pOptions = {
      ...options.libp2p,
      filterMultiaddrs: false,
    };

    if (this.enrBootstrap) {
      const multiaddrs = await this.getBootstrapMultiaddrs();

      if (multiaddrs.length > 0) {
        libp2pConfig.peerDiscovery = [
          bootstrap({ list: multiaddrs }),
          ...(options.libp2p?.peerDiscovery || []),
        ];
      }
    }

    const createOptions = {
      ...options,
      networkConfig: this.networkConfig,
      libp2p: libp2pConfig,
    };

    this.waku = await createLightNode(createOptions);
    return { success: true };
  }

  async startNode() {
    if (!this.waku) {
      throw new Error("Waku node not created");
    }
    await this.waku.start();

    if (this.lightpushNode) {
      await this.dialPreferredLightpushNode();
    }

    return { success: true };
  }

  private async dialPreferredLightpushNode() {
    if (!this.waku || !this.lightpushNode) {
      log.info("Skipping dial: waku or lightpushNode not set");
      return;
    }

    try {
      log.info("Attempting to dial preferred lightpush node:", this.lightpushNode);
      await this.waku.dial(this.lightpushNode);
      log.info("Successfully dialed preferred lightpush node:", this.lightpushNode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(
        "Failed to dial preferred lightpush node:",
        this.lightpushNode,
        message
      );
    }
  }

  private getPeerIdFromMultiaddr(multiaddr: string): string | null {
    const parts = multiaddr.split("/");
    const p2pIndex = parts.indexOf("p2p");
    return p2pIndex !== -1 && p2pIndex + 1 < parts.length
      ? parts[p2pIndex + 1]
      : null;
  }

  async stopNode() {
    if (!this.waku) {
      throw new Error("Waku node not created");
    }
    await this.waku.stop();
    return { success: true };
  }

  getPeerInfo() {
    if (!this.waku) {
      throw new Error("Waku node not started");
    }

    const addrs = this.waku.libp2p.getMultiaddrs();
    return {
      peerId: this.waku.libp2p.peerId.toString(),
      multiaddrs: addrs.map((a: Multiaddr) => a.toString()),
      peers: [],
    };
  }
}

(() => {
  try {
    log.info("Initializing WakuHeadless...");

    const testWindow = window as ITestBrowser;
    const globalNetworkConfig = testWindow.__WAKU_NETWORK_CONFIG;
    const globalLightpushNode = testWindow.__WAKU_LIGHTPUSH_NODE;
    const globalEnrBootstrap = testWindow.__WAKU_ENR_BOOTSTRAP;

    log.info("Global config from window:", {
      networkConfig: globalNetworkConfig,
      lightpushNode: globalLightpushNode,
      enrBootstrap: globalEnrBootstrap
    });

    const instance = new WakuHeadless(
      globalNetworkConfig,
      globalLightpushNode,
      globalEnrBootstrap,
    );

    testWindow.wakuApi = instance;
    log.info("WakuHeadless initialized successfully:", !!testWindow.wakuApi);
  } catch (error) {
    log.error("Error initializing WakuHeadless:", error);
    const testWindow = window as ITestBrowser;
    // Create a stub wakuApi that will reject all method calls
    testWindow.wakuApi = {
      waku: null,
      networkConfig: { clusterId: 0, numShardsInCluster: 0 },
      lightpushNode: null,
      enrBootstrap: null,
      error,
      createWakuNode: () => Promise.reject(new Error("WakuHeadless failed to initialize")),
      startNode: () => Promise.reject(new Error("WakuHeadless failed to initialize")),
      stopNode: () => Promise.reject(new Error("WakuHeadless failed to initialize")),
      pushMessageV3: () => Promise.reject(new Error("WakuHeadless failed to initialize")),
      waitForPeers: () => Promise.reject(new Error("WakuHeadless failed to initialize")),
      getPeerInfo: () => { throw new Error("WakuHeadless failed to initialize"); },
    } as unknown as WakuHeadless;
  }
})();
