import type { PeerId, StreamHandler } from "@libp2p/interface";
import {
  type ContentTopic,
  type FilterCoreResult,
  FilterError,
  type Libp2p,
  type PubsubTopic
} from "@waku/interfaces";
import { WakuMessage } from "@waku/proto";
import { Logger } from "@waku/utils";
import all from "it-all";
import * as lp from "it-length-prefixed";
import { pipe } from "it-pipe";
import { Uint8ArrayList } from "uint8arraylist";

import { StreamManager } from "../stream_manager/index.js";

import {
  FilterPushRpc,
  FilterSubscribeResponse,
  FilterSubscribeRpc
} from "./filter_rpc.js";

const log = new Logger("filter-core");

export const FilterCodecs = {
  SUBSCRIBE: "/vac/waku/filter-subscribe/2.0.0-beta1",
  PUSH: "/vac/waku/filter-push/2.0.0-beta1"
};

type IncomingMessageHandler = (
  pubsubTopic: PubsubTopic,
  wakuMessage: WakuMessage,
  peerIdStr: string
) => Promise<void>;

export class FilterCore {
  private streamManager: StreamManager;

  public readonly multicodec = FilterCodecs.SUBSCRIBE;

  public constructor(
    private handleIncomingMessage: IncomingMessageHandler,
    private libp2p: Libp2p
  ) {
    this.streamManager = new StreamManager(
      FilterCodecs.SUBSCRIBE,
      libp2p.components
    );
  }

  public async start(): Promise<void> {
    try {
      await this.libp2p.handle(FilterCodecs.PUSH, this.onRequest, {
        maxInboundStreams: 100
      });
    } catch (e) {
      log.error("Failed to register ", FilterCodecs.PUSH, e);
    }
  }

  public async stop(): Promise<void> {
    this.streamManager.stop();
    try {
      await this.libp2p.unhandle(FilterCodecs.PUSH);
    } catch (e) {
      log.error("Failed to unregister ", FilterCodecs.PUSH, e);
    }
  }

  public async subscribe(
    pubsubTopic: PubsubTopic,
    peerId: PeerId,
    contentTopics: ContentTopic[]
  ): Promise<FilterCoreResult> {
    const stream = await this.streamManager.getStream(peerId);

    if (!stream) {
      return {
        success: null,
        failure: {
          error: FilterError.NO_STREAM_AVAILABLE,
          peerId: peerId
        }
      };
    }

    const request = FilterSubscribeRpc.createSubscribeRequest(
      pubsubTopic,
      contentTopics
    );

    let res: Uint8ArrayList[] | undefined;
    try {
      res = await pipe(
        [request.encode()],
        lp.encode,
        stream,
        lp.decode,
        async (source) => await all(source)
      );

      if (!res?.length) {
        throw Error("Received no response from subscription request.");
      }
    } catch (error) {
      log.error("Failed to send subscribe request", error);
      return {
        success: null,
        failure: {
          error: FilterError.GENERIC_FAIL,
          peerId: peerId
        }
      };
    }

    const { statusCode, requestId, statusDesc } =
      FilterSubscribeResponse.decode(res[0].slice());

    if (statusCode < 200 || statusCode >= 300) {
      log.error(
        `Filter subscribe request ${requestId} failed with status code ${statusCode}: ${statusDesc}`
      );
      return {
        failure: {
          error: FilterError.REMOTE_PEER_REJECTED,
          peerId: peerId
        },
        success: null
      };
    }

    return {
      failure: null,
      success: peerId
    };
  }

  public async unsubscribe(
    pubsubTopic: PubsubTopic,
    peerId: PeerId,
    contentTopics: ContentTopic[]
  ): Promise<FilterCoreResult> {
    const stream = await this.streamManager.getStream(peerId);

    if (!stream) {
      log.error(`Failed to get a stream for remote peer:${peerId.toString()}`);
      return {
        success: null,
        failure: {
          error: FilterError.NO_STREAM_AVAILABLE,
          peerId: peerId
        }
      };
    }

    const unsubscribeRequest = FilterSubscribeRpc.createUnsubscribeRequest(
      pubsubTopic,
      contentTopics
    );

    try {
      await pipe([unsubscribeRequest.encode()], lp.encode, stream.sink);
    } catch (error) {
      log.error("Failed to send unsubscribe request", error);
      return {
        success: null,
        failure: {
          error: FilterError.GENERIC_FAIL,
          peerId: peerId
        }
      };
    }

    return {
      success: peerId,
      failure: null
    };
  }

  public async unsubscribeAll(
    pubsubTopic: PubsubTopic,
    peerId: PeerId
  ): Promise<FilterCoreResult> {
    const stream = await this.streamManager.getStream(peerId);

    if (!stream) {
      log.error(`Failed to get a stream for remote peer:${peerId.toString()}`);
      return {
        success: null,
        failure: {
          error: FilterError.NO_STREAM_AVAILABLE,
          peerId: peerId
        }
      };
    }

    const request = FilterSubscribeRpc.createUnsubscribeAllRequest(pubsubTopic);

    const res = await pipe(
      [request.encode()],
      lp.encode,
      stream,
      lp.decode,
      async (source) => await all(source)
    );

    if (!res || !res.length) {
      return {
        failure: {
          error: FilterError.NO_RESPONSE,
          peerId: peerId
        },
        success: null
      };
    }

    const { statusCode, requestId, statusDesc } =
      FilterSubscribeResponse.decode(res[0].slice());

    if (statusCode < 200 || statusCode >= 300) {
      log.error(
        `Filter unsubscribe all request ${requestId} failed with status code ${statusCode}: ${statusDesc}`
      );
      return {
        failure: {
          error: FilterError.REMOTE_PEER_REJECTED,
          peerId: peerId
        },
        success: null
      };
    }

    return {
      failure: null,
      success: peerId
    };
  }

  public async ping(peerId: PeerId): Promise<FilterCoreResult> {
    const stream = await this.streamManager.getStream(peerId);

    if (!stream) {
      log.error(`Failed to get a stream for remote peer:${peerId.toString()}`);
      return {
        success: null,
        failure: {
          error: FilterError.NO_STREAM_AVAILABLE,
          peerId: peerId
        }
      };
    }

    const request = FilterSubscribeRpc.createSubscriberPingRequest();

    let res: Uint8ArrayList[] | undefined;
    try {
      res = await pipe(
        [request.encode()],
        lp.encode,
        stream,
        lp.decode,
        async (source) => await all(source)
      );
    } catch (error) {
      log.error("Failed to send ping request", error);
      return {
        success: null,
        failure: {
          error: FilterError.GENERIC_FAIL,
          peerId: peerId
        }
      };
    }

    if (!res || !res.length) {
      return {
        success: null,
        failure: {
          error: FilterError.NO_RESPONSE,
          peerId: peerId
        }
      };
    }

    const { statusCode, requestId, statusDesc } =
      FilterSubscribeResponse.decode(res[0].slice());

    if (statusCode < 200 || statusCode >= 300) {
      log.error(
        `Filter ping request ${requestId} failed with status code ${statusCode}: ${statusDesc}`
      );
      return {
        success: null,
        failure: {
          error: FilterError.REMOTE_PEER_REJECTED,
          peerId: peerId
        }
      };
    }
    return {
      success: peerId,
      failure: null
    };
  }

  private onRequest: StreamHandler = (streamData) => {
    const { connection, stream } = streamData;
    const { remotePeer } = connection;
    log.info(`Received message from ${remotePeer.toString()}`);
    try {
      pipe(stream, lp.decode, async (source) => {
        for await (const bytes of source) {
          const response = FilterPushRpc.decode(bytes.slice());

          const { pubsubTopic, wakuMessage } = response;

          if (!wakuMessage) {
            log.error("Received empty message");
            return;
          }

          if (!pubsubTopic) {
            log.error("Pubsub topic missing from push message");
            return;
          }

          await this.handleIncomingMessage(
            pubsubTopic,
            wakuMessage,
            connection.remotePeer.toString()
          );
        }
      }).then(
        () => {
          log.info("Receiving pipe closed.");
        },
        async (e) => {
          log.error(
            `Error with receiving pipe on peer:${connection.remotePeer.toString()} -- stream:${stream.id} -- protocol:${stream.protocol}: `,
            e
          );
        }
      );
    } catch (e) {
      log.error("Error decoding message", e);
    }
  };
}
