import { TypedEventEmitter } from "@libp2p/interface";
import { messageHash } from "@waku/core";
import {
  type Callback,
  type IDecodedMessage,
  type IDecoder,
  type IEncoder,
  type IMessage,
  ISendOptions,
  type IWaku,
  LightPushError,
  LightPushSDKResult,
  QueryRequestParams
} from "@waku/interfaces";
import {
  type ChannelId,
  isContentMessage,
  MessageChannel,
  MessageChannelEvent,
  MessageChannelEvents,
  type MessageChannelOptions,
  Message as SdsMessage,
  type SenderId,
  SyncMessage
} from "@waku/sds";
import { Logger } from "@waku/utils";

import {
  QueryOnConnect,
  QueryOnConnectEvent
} from "../query_on_connect/index.js";

import { ReliableChannelEvent, ReliableChannelEvents } from "./events.js";
import { MissingMessageRetriever } from "./missing_message_retriever.js";
import { RandomTimeout } from "./random_timeout.js";
import { RetryManager } from "./retry_manager.js";
import { ISyncStatusEvents, SyncStatus } from "./sync_status.js";

const log = new Logger("sdk:reliable-channel");

const DEFAULT_SYNC_MIN_INTERVAL_MS = 30 * 1000; // 30 seconds
const DEFAULT_RETRY_INTERVAL_MS = 30 * 1000; // 30 seconds
const DEFAULT_MAX_RETRY_ATTEMPTS = 10;
const DEFAULT_SWEEP_IN_BUF_INTERVAL_MS = 5 * 1000;
const DEFAULT_PROCESS_TASK_MIN_ELAPSE_MS = 1000;

const IRRECOVERABLE_SENDING_ERRORS: LightPushError[] = [
  LightPushError.ENCODE_FAILED,
  LightPushError.EMPTY_PAYLOAD,
  LightPushError.SIZE_TOO_BIG,
  LightPushError.RLN_PROOF_GENERATION
];

export type ReliableChannelOptions = MessageChannelOptions & {
  /**
   * The minimum interval between 2 sync messages in the channel.
   *
   * Meaning, how frequently we want messages in the channel, noting that the
   * responsibility of sending a sync messages is shared between participants
   * of the channel.
   *
   * `0` means no sync messages will be sent.
   *
   * @default 30,000 (30 seconds) [[DEFAULT_SYNC_MIN_INTERVAL_MS]]
   */
  syncMinIntervalMs?: number;

  /**
   * How long to wait before re-sending a message that as not acknowledged.
   *
   * @default 60,000 (60 seconds) [[DEFAULT_RETRY_INTERVAL_MS]]
   */
  retryIntervalMs?: number;

  /**
   * How many times do we attempt resending messages that were not acknowledged.
   *
   * @default 10 [[DEFAULT_MAX_RETRY_ATTEMPTS]]
   */
  maxRetryAttempts?: number;

  /**
   * How often store queries are done to retrieve missing messages.
   *
   * @default 10,000 (10 seconds)
   */
  retrieveFrequencyMs?: number;

  /**
   * How often SDS message channel incoming buffer is swept.
   *
   * @default 5000 (every 5 seconds)
   */
  sweepInBufIntervalMs?: number;

  /**
   * Whether to automatically do a store query after connection to store nodes.
   *
   * @default true
   */
  queryOnConnect?: boolean;

  /**
   * Whether to auto start the message channel
   *
   * @default true
   */
  autoStart?: boolean;

  /** The minimum elapse time between calling the underlying channel process
   * task for incoming messages. This is to avoid overload when processing
   * a lot of messages.
   *
   * @default 1000 (1 second)
   */
  processTaskMinElapseMs?: number;
};

/**
 * An easy-to-use reliable channel that ensures all participants to the channel have eventual message consistency.
 *
 * Use events to track:
 * - if your outgoing messages are sent, acknowledged or error out
 * - for new incoming messages
 * @emits [[ReliableChannelEvents]]
 *
 */
export class ReliableChannel<
  T extends IDecodedMessage
> extends TypedEventEmitter<ReliableChannelEvents> {
  private readonly _send: (
    encoder: IEncoder,
    message: IMessage,
    sendOptions?: ISendOptions
  ) => Promise<LightPushSDKResult>;

  private readonly _subscribe: (
    decoders: IDecoder<T> | IDecoder<T>[],
    callback: Callback<T>
  ) => Promise<boolean>;

  private readonly _unsubscribe?: (
    decoders: IDecoder<T> | IDecoder<T>[]
  ) => Promise<boolean>;

  private readonly _retrieve?: <T extends IDecodedMessage>(
    decoders: IDecoder<T>[],
    options?: Partial<QueryRequestParams>
  ) => AsyncGenerator<Promise<T | undefined>[]>;

  private eventListenerCleanups: Array<() => void> = [];
  private syncRandomTimeout: RandomTimeout;
  private sweepInBufInterval: ReturnType<typeof setInterval> | undefined;
  private readonly sweepInBufIntervalMs: number;
  private processTaskTimeout: ReturnType<typeof setTimeout> | undefined;
  private readonly retryManager: RetryManager | undefined;
  private readonly missingMessageRetriever?: MissingMessageRetriever<T>;
  private readonly queryOnConnect?: QueryOnConnect<T>;
  private readonly processTaskMinElapseMs: number;
  private _started: boolean;
  private activePendingProcessTask?: Promise<void>;

  private constructor(
    public node: IWaku,
    public messageChannel: MessageChannel,
    private encoder: IEncoder,
    private decoder: IDecoder<T>,
    options?: ReliableChannelOptions
  ) {
    super();
    if (node.lightPush) {
      this._send = node.lightPush.send.bind(node.lightPush);
    } else if (node.relay) {
      this._send = node.relay.send.bind(node.relay);
    } else {
      throw "No protocol available to send messages";
    }

    if (node.filter) {
      this._subscribe = node.filter.subscribe.bind(node.filter);
      this._unsubscribe = node.filter.unsubscribe.bind(node.filter);
    } else if (node.relay) {
      // TODO: Why do relay and filter have different interfaces?
      //  this._subscribe = node.relay.subscribeWithUnsubscribe;
      throw "Not implemented";
    } else {
      throw "No protocol available to receive messages";
    }

    if (node.store) {
      this._retrieve = node.store.queryGenerator.bind(node.store);
      const peerManagerEvents = (node as any)?.peerManager?.events;
      if (
        peerManagerEvents !== undefined &&
        (options?.queryOnConnect ?? true)
      ) {
        this.queryOnConnect = new QueryOnConnect(
          [this.decoder],
          this.isChannelMessageWithCausalHistory.bind(this),
          peerManagerEvents,
          node.events,
          this._retrieve.bind(this)
        );
      }
    }

    this.syncRandomTimeout = new RandomTimeout(
      options?.syncMinIntervalMs ?? DEFAULT_SYNC_MIN_INTERVAL_MS,
      2,
      this.sendSyncMessage.bind(this)
    );

    this.sweepInBufIntervalMs =
      options?.sweepInBufIntervalMs ?? DEFAULT_SWEEP_IN_BUF_INTERVAL_MS;

    const retryIntervalMs =
      options?.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
    const maxRetryAttempts =
      options?.maxRetryAttempts ?? DEFAULT_MAX_RETRY_ATTEMPTS;

    if (retryIntervalMs && maxRetryAttempts) {
      // TODO: there is a lot to improve. e.g. not point retry to send if node is offline.
      this.retryManager = new RetryManager(retryIntervalMs, maxRetryAttempts);
    }

    this.processTaskMinElapseMs =
      options?.processTaskMinElapseMs ?? DEFAULT_PROCESS_TASK_MIN_ELAPSE_MS;

    if (this._retrieve) {
      this.missingMessageRetriever = new MissingMessageRetriever(
        this.decoder,
        options?.retrieveFrequencyMs,
        this._retrieve,
        async (msg: T) => {
          await this.processIncomingMessage(msg);
        }
      );
    }

    this._started = false;

    this._internalSyncStatus = new SyncStatus();
    this.syncStatus = this._internalSyncStatus;
  }

  /**
   * Emit events when the channel is aware of missing message.
   * Note that "synced" may mean some messages are irretrievably lost.
   * Check the emitted data for details.
   *
   * @emits [[StatusEvents]]
   *
   */
  public readonly syncStatus: ISyncStatusEvents;
  private readonly _internalSyncStatus: SyncStatus;

  public get isStarted(): boolean {
    return this._started;
  }

  /**
   * Used to identify messages, pass the payload of a message you are
   * about to send to track the events for this message.
   * This is pre-sds wrapping
   * @param messagePayload
   */
  public static getMessageId(messagePayload: Uint8Array): string {
    return MessageChannel.getMessageId(messagePayload);
  }

  /**
   * Create a new message channels. Message channels enables end-to-end
   * reliability by ensuring that all messages in the channel are received
   * by other users, and retrieved by this local node.
   *
   * emits events about outgoing messages, see [[`ReliableChannel`]] docs.
   *
   * Note that all participants in a message channels need to get the messages
   * from the channel. Meaning:
   * - all participants must be able to decrypt the messages
   * - all participants must be subscribing to content topic(s) where the messages are sent
   *
   * @param node The waku node to use to send and receive messages
   * @param channelId An id for the channel, all participants of the channel should use the same id
   * @param senderId An id for the sender, to ensure acknowledgements are only valid if originating from someone else; best if persisted between sessions
   * @param encoder A channel operates within a singular encryption layer, hence the same encoder is needed for all messages
   * @param decoder A channel operates within a singular encryption layer, hence the same decoder is needed for all messages
   * @param options
   */
  public static async create<T extends IDecodedMessage>(
    node: IWaku,
    channelId: ChannelId,
    senderId: SenderId,
    encoder: IEncoder,
    decoder: IDecoder<T>,
    options?: ReliableChannelOptions
  ): Promise<ReliableChannel<T>> {
    const sdsMessageChannel = new MessageChannel(channelId, senderId, options);
    const messageChannel = new ReliableChannel(
      node,
      sdsMessageChannel,
      encoder,
      decoder,
      options
    );

    const autoStart = options?.autoStart ?? true;
    if (autoStart) {
      await messageChannel.start();
    }

    return messageChannel;
  }

  /**
   * Sends a message in the channel, will attempt to re-send if not acknowledged
   * by other participants.
   *
   * @param messagePayload
   * @returns the message id
   */
  public send(messagePayload: Uint8Array): string {
    const messageId = ReliableChannel.getMessageId(messagePayload);
    if (!this._started) {
      this.safeSendEvent("sending-message-irrecoverable-error", {
        detail: { messageId: messageId, error: "channel is not started" }
      });
    }
    const wrapAndSendBind = this._wrapAndSend.bind(this, messagePayload);
    this.retryManager?.startRetries(messageId, wrapAndSendBind);
    wrapAndSendBind();
    return messageId;
  }

  private _wrapAndSend(messagePayload: Uint8Array): void {
    this.messageChannel.pushOutgoingMessage(
      messagePayload,
      async (
        sdsMessage: SdsMessage
      ): Promise<{ success: boolean; retrievalHint?: Uint8Array }> => {
        // Callback is called once message has added to the SDS outgoing queue
        // We start by trying to send the message now.

        // `payload` wrapped in SDS
        const sdsPayload = sdsMessage.encode();

        const wakuMessage = {
          payload: sdsPayload
        };

        const messageId = ReliableChannel.getMessageId(messagePayload);

        // TODO: should the encoder give me the message hash?
        // Encoding now to fail early, used later to get message hash
        const protoMessage = await this.encoder.toProtoObj(wakuMessage);
        if (!protoMessage) {
          this.safeSendEvent("sending-message-irrecoverable-error", {
            detail: {
              messageId: messageId,
              error: "could not encode message"
            }
          });
          return { success: false };
        }
        const retrievalHint = messageHash(
          this.encoder.pubsubTopic,
          protoMessage
        );

        this.safeSendEvent("sending-message", {
          detail: messageId
        });

        const sendRes = await this._send(this.encoder, wakuMessage);

        // If it's a recoverable failure, we will try again to send later
        // If not, then we should error to the user now
        for (const { error } of sendRes.failures) {
          if (IRRECOVERABLE_SENDING_ERRORS.includes(error)) {
            // Not recoverable, best to return it
            log.error("Irrecoverable error, cannot send message: ", error);
            this.safeSendEvent("sending-message-irrecoverable-error", {
              detail: {
                messageId,
                error
              }
            });
            return { success: false, retrievalHint };
          }
        }

        return {
          success: true,
          retrievalHint
        };
      }
    );

    // Process outgoing messages straight away
    this.messageChannel
      .processTasks()
      .then(() => {
        this.messageChannel.sweepOutgoingBuffer();
      })
      .catch((err) => {
        log.error("error encountered when processing sds tasks", err);
      });
  }

  private async subscribe(): Promise<boolean> {
    this.assertStarted();
    return this._subscribe(this.decoder, async (message: T) => {
      if (!this._started) {
        log.info("ReliableChannel stopped, ignoring incoming message");
        return;
      }
      await this.processIncomingMessage(message);
    });
  }

  private async unsubscribe(): Promise<boolean> {
    if (!this._unsubscribe) {
      throw Error("No unsubscribe method available");
    }
    return this._unsubscribe(this.decoder);
  }

  /**
   * Don't forget to call `this.messageChannel.sweepIncomingBuffer();` once done.
   * @param msg
   * @private
   */
  private async processIncomingMessage<T extends IDecodedMessage>(
    msg: T
  ): Promise<void> {
    // New message arrives, we need to unwrap it first
    const sdsMessage = SdsMessage.decode(msg.payload);

    if (!sdsMessage) {
      log.error("could not SDS decode message", msg);
      return;
    }

    if (sdsMessage.channelId !== this.messageChannel.channelId) {
      log.warn(
        "ignoring message with different channel id",
        sdsMessage.channelId
      );
      return;
    }

    const retrievalHint = msg.hash;
    log.info(`processing message ${sdsMessage.messageId}:${msg.hashStr}`);
    // SDS Message decoded, let's pass it to the channel so we can learn about
    // missing messages or the status of previous outgoing messages
    this.messageChannel.pushIncomingMessage(sdsMessage, retrievalHint);

    this.missingMessageRetriever?.removeMissingMessage(sdsMessage.messageId);

    if (sdsMessage.content && sdsMessage.content.length > 0) {
      // Now, process the message with callback

      // Overrides msg.payload with unwrapped payload
      // TODO: can we do better?
      const { payload: _p, ...allButPayload } = msg;
      const unwrappedMessage = Object.assign(allButPayload, {
        payload: sdsMessage.content,
        hash: msg.hash,
        hashStr: msg.hashStr,
        version: msg.version,
        contentTopic: msg.contentTopic,
        pubsubTopic: msg.pubsubTopic,
        timestamp: msg.timestamp,
        rateLimitProof: msg.rateLimitProof,
        ephemeral: msg.ephemeral,
        meta: msg.meta
      });

      this.safeSendEvent("message-received", {
        detail: unwrappedMessage as unknown as T
      });
    }

    this.queueProcessTasks();
  }

  private async processIncomingMessages<T extends IDecodedMessage>(
    messages: T[]
  ): Promise<void> {
    for (const message of messages) {
      await this.processIncomingMessage(message);
    }
  }

  // TODO: For now we only queue process tasks for incoming messages
  // As this is where there is most volume
  private queueProcessTasks(): void {
    if (!this._started) return;

    // If one is already queued, then we can ignore it
    if (this.processTaskTimeout === undefined) {
      this.processTaskTimeout = setTimeout(() => {
        this.activePendingProcessTask = this.messageChannel
          .processTasks()
          .catch((err) => {
            log.error("error encountered when processing sds tasks", err);
          })
          .finally(() => {
            this.activePendingProcessTask = undefined;
          });

        // Clear timeout once triggered
        this.clearProcessTasks();
      }, this.processTaskMinElapseMs); // we ensure that we don't call process tasks more than once per second
    }
  }

  private clearProcessTasks(): void {
    if (this.processTaskTimeout) {
      clearTimeout(this.processTaskTimeout);
      this.processTaskTimeout = undefined;
    }
  }

  public async start(): Promise<boolean> {
    if (this._started) return true;
    this._started = true;
    this.setupEventListeners();
    this.restartSync();
    this.startSweepIncomingBufferLoop();
    if (this._retrieve) {
      this.missingMessageRetriever?.start();
      this.queryOnConnect?.start();
    }
    return this.subscribe();
  }

  public async stop(): Promise<void> {
    if (!this._started) return;

    log.info("Stopping ReliableChannel...");
    this._started = false;

    this.removeAllEventListeners();
    this.stopSync();
    this.stopSweepIncomingBufferLoop();
    this.clearProcessTasks();

    if (this.activePendingProcessTask) {
      await this.activePendingProcessTask;
    }

    await this.missingMessageRetriever?.stop();

    await this.queryOnConnect?.stop();

    this.retryManager?.stopAllRetries();

    await this.unsubscribe();

    this._internalSyncStatus.cleanUp();

    log.info("ReliableChannel stopped successfully");
  }

  private assertStarted(): void {
    if (!this._started) throw Error("Message Channel must be started");
  }

  private startSweepIncomingBufferLoop(): void {
    this.stopSweepIncomingBufferLoop();
    this.sweepInBufInterval = setInterval(() => {
      log.info("sweep incoming buffer");
      this.messageChannel.sweepIncomingBuffer();
    }, this.sweepInBufIntervalMs);
  }

  private stopSweepIncomingBufferLoop(): void {
    if (this.sweepInBufInterval) {
      clearInterval(this.sweepInBufInterval);
      this.sweepInBufInterval = undefined;
    }
  }

  private restartSync(multiplier: number = 1): void {
    this.syncRandomTimeout.restart(multiplier);
  }

  private stopSync(): void {
    this.syncRandomTimeout.stop();
  }

  private safeSendEvent<T extends ReliableChannelEvent>(
    event: T,
    eventInit?: CustomEventInit
  ): void {
    try {
      this.dispatchEvent(new CustomEvent(event, eventInit));
    } catch (error) {
      log.error(`Failed to dispatch event ${event}:`, error);
    }
  }

  private async sendSyncMessage(): Promise<void> {
    this.assertStarted();
    await this.messageChannel.pushOutgoingSyncMessage(
      async (syncMessage: SyncMessage): Promise<boolean> => {
        // Callback is called once message has added to the SDS outgoing queue
        // We start by trying to send the message now.

        // `payload` wrapped in SDS
        const sdsPayload = syncMessage.encode();

        const wakuMessage = {
          payload: sdsPayload
        };

        const sendRes = await this._send(this.encoder, wakuMessage);
        if (sendRes.failures.length > 0) {
          log.error("Error sending sync message: ", sendRes);
          return false;
        }

        return true;
      }
    );

    // Process outgoing messages straight away
    // TODO: review and optimize
    await this.messageChannel.processTasks();
    this.messageChannel.sweepOutgoingBuffer();
  }

  private isChannelMessageWithCausalHistory(msg: T): boolean {
    // TODO: we do end-up decoding messages twice as this is used to stop store queries.
    const sdsMessage = SdsMessage.decode(msg.payload);

    if (!sdsMessage) {
      return false;
    }

    if (sdsMessage.channelId !== this.messageChannel.channelId) {
      return false;
    }

    return sdsMessage.causalHistory && sdsMessage.causalHistory.length > 0;
  }

  private addTrackedEventListener<K extends keyof MessageChannelEvents>(
    eventName: K,
    listener: (event: MessageChannelEvents[K]) => void
  ): void {
    this.messageChannel.addEventListener(eventName, listener as any);

    this.eventListenerCleanups.push(() => {
      this.messageChannel.removeEventListener(eventName, listener as any);
    });
  }

  private setupEventListeners(): void {
    this.addTrackedEventListener(
      MessageChannelEvent.OutMessageSent,
      (event) => {
        if (isContentMessage(event.detail)) {
          const messageId = ReliableChannel.getMessageId(event.detail.content);
          this.safeSendEvent("message-sent", {
            detail: messageId
          });

          // restart the timeout when a content message has been sent
          // because the functionality is fulfilled (content message contains
          // causal history)
          this.restartSync();
        }
      }
    );

    this.addTrackedEventListener(
      MessageChannelEvent.OutMessageAcknowledged,
      (event) => {
        if (event.detail) {
          this.safeSendEvent("message-acknowledged", {
            detail: event.detail
          });

          // Stopping retries as the message was acknowledged
          this.retryManager?.stopRetries(event.detail);
        }
      }
    );

    this.addTrackedEventListener(
      MessageChannelEvent.OutMessagePossiblyAcknowledged,
      (event) => {
        if (event.detail) {
          this.safeSendEvent("message-possibly-acknowledged", {
            detail: {
              messageId: event.detail.messageId,
              possibleAckCount: event.detail.count
            }
          });
        }
      }
    );

    this.addTrackedEventListener(
      MessageChannelEvent.InSyncReceived,
      (_event) => {
        // restart the timeout when a sync message has been received
        this.restartSync();
      }
    );

    this.addTrackedEventListener(
      MessageChannelEvent.InMessageReceived,
      (event) => {
        this._internalSyncStatus.onMessagesReceived(event.detail.messageId);
        // restart the timeout when a content message has been received
        if (isContentMessage(event.detail)) {
          // send a sync message faster to ack someone's else
          this.restartSync(0.5);
        }
      }
    );

    this.addTrackedEventListener(
      MessageChannelEvent.InMessageMissing,
      (event) => {
        this._internalSyncStatus.onMessagesMissing(
          ...event.detail.map((m) => m.messageId)
        );

        for (const { messageId, retrievalHint } of event.detail) {
          if (retrievalHint && this.missingMessageRetriever) {
            this.missingMessageRetriever.addMissingMessage(
              messageId,
              retrievalHint
            );
          }
        }
      }
    );

    this.addTrackedEventListener(MessageChannelEvent.InMessageLost, (event) => {
      this._internalSyncStatus.onMessagesLost(
        ...event.detail.map((m) => m.messageId)
      );
    });

    if (this.queryOnConnect) {
      const queryListener = (event: any): void => {
        void this.processIncomingMessages(event.detail);
      };

      this.queryOnConnect.addEventListener(
        QueryOnConnectEvent.MessagesRetrieved,
        queryListener
      );

      this.eventListenerCleanups.push(() => {
        this.queryOnConnect?.removeEventListener(
          QueryOnConnectEvent.MessagesRetrieved,
          queryListener
        );
      });
    }
  }

  private removeAllEventListeners(): void {
    for (const cleanup of this.eventListenerCleanups) {
      try {
        cleanup();
      } catch (error) {
        log.error("error removing event listener:", error);
      }
    }
    this.eventListenerCleanups = [];
  }
}
