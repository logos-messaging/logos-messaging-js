import { Peer, PeerId, Stream, TypedEventEmitter } from "@libp2p/interface";
import { MultiaddrInput } from "@multiformats/multiaddr";
import {
  Callback,
  CreateDecoderParams,
  CreateEncoderParams,
  HealthStatus,
  IDecodedMessage,
  IDecoder,
  IEncoder,
  IFilter,
  ILightPush,
  type IMessage,
  IRelay,
  ISendOptions,
  IStore,
  IWaku,
  IWakuEventEmitter,
  Libp2p,
  LightPushSDKResult,
  Protocols
} from "@waku/interfaces";

export type MockWakuEvents = {
  ["new-message"]: CustomEvent<IDecodedMessage>;
};

export class MockWakuNode implements IWaku {
  public relay?: IRelay;
  public store?: IStore;
  public filter?: IFilter;
  public lightPush?: ILightPush;
  public protocols: string[];

  private readonly subscriptions: {
    decoders: IDecoder<any>[];
    callback: Callback<any>;
  }[];

  public constructor(
    private mockMessageEmitter?: TypedEventEmitter<MockWakuEvents>
  ) {
    this.protocols = [];
    this.events = new TypedEventEmitter();
    this.subscriptions = [];

    this.lightPush = {
      multicodec: [],
      send: this._send.bind(this),
      start(): void {},
      stop(): void {}
    };

    this.filter = {
      start: async () => {},
      stop: async () => {},
      multicodec: "filter",
      subscribe: this._subscribe.bind(this),
      unsubscribe<T extends IDecodedMessage>(
        _decoders: IDecoder<T> | IDecoder<T>[]
      ): Promise<boolean> {
        // The expectation is that it does not matter for tests
        return Promise.resolve(true);
      },
      unsubscribeAll(): void {
        throw "unsubscribeAll not implemented";
      }
    };
  }

  public get libp2p(): Libp2p {
    throw "No libp2p on MockWakuNode";
  }

  private async _send(
    encoder: IEncoder,
    message: IMessage,
    _sendOptions?: ISendOptions
  ): Promise<LightPushSDKResult> {
    for (const { decoders, callback } of this.subscriptions) {
      const protoMessage = await encoder.toProtoObj(message);
      if (!protoMessage) throw "Issue in mock encoding message";
      for (const decoder of decoders) {
        const decodedMessage = await decoder.fromProtoObj(
          decoder.pubsubTopic,
          protoMessage
        );
        if (!decodedMessage) throw "Issue in mock decoding message";
        await callback(decodedMessage);
        if (this.mockMessageEmitter) {
          this.mockMessageEmitter.dispatchEvent(
            new CustomEvent<IDecodedMessage>("new-message", {
              detail: decodedMessage
            })
          );
        }
      }
    }
    return {
      failures: [],
      successes: []
    };
  }

  private async _subscribe<T extends IDecodedMessage>(
    decoders: IDecoder<T> | IDecoder<T>[],
    callback: Callback<T>
  ): Promise<boolean> {
    this.subscriptions.push({
      decoders: Array.isArray(decoders) ? decoders : [decoders],
      callback
    });
    if (this.mockMessageEmitter) {
      this.mockMessageEmitter.addEventListener("new-message", (event) => {
        void callback(event.detail as unknown as T);
      });
    }
    return Promise.resolve(true);
  }

  public events: IWakuEventEmitter;

  public get peerId(): PeerId {
    throw "no peerId on MockWakuNode";
  }
  public get health(): HealthStatus {
    throw "no health on MockWakuNode";
  }
  public dial(
    _peer: PeerId | MultiaddrInput,
    _protocols?: Protocols[]
  ): Promise<Stream> {
    throw new Error("Method not implemented.");
  }
  public hangUp(_peer: PeerId | MultiaddrInput): Promise<boolean> {
    throw new Error("Method not implemented.");
  }
  public start(): Promise<void> {
    return Promise.resolve();
  }
  public stop(): Promise<void> {
    return Promise.resolve();
  }
  public waitForPeers(
    _protocols?: Protocols[],
    _timeoutMs?: number
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }
  public createDecoder(
    _params: CreateDecoderParams
  ): IDecoder<IDecodedMessage> {
    throw new Error("Method not implemented.");
  }
  public createEncoder(_params: CreateEncoderParams): IEncoder {
    throw new Error("Method not implemented.");
  }
  public isStarted(): boolean {
    throw new Error("Method not implemented.");
  }
  public isConnected(): boolean {
    throw new Error("Method not implemented.");
  }
  public getConnectedPeers(): Promise<Peer[]> {
    throw new Error("Method not implemented.");
  }
}
