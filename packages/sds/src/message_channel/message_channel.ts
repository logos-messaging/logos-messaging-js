import { TypedEventEmitter } from "@libp2p/interface";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { Logger } from "@waku/utils";

import { DefaultBloomFilter } from "../bloom_filter/bloom.js";

import { Command, Handlers, ParamsByAction, Task } from "./command_queue.js";
import { MessageChannelEvent, MessageChannelEvents } from "./events.js";
import { MemLocalHistory } from "./mem_local_history.js";
import {
  ChannelId,
  ContentMessage,
  EphemeralMessage,
  HistoryEntry,
  isContentMessage,
  isEphemeralMessage,
  isSyncMessage,
  Message,
  MessageId,
  ParticipantId,
  SyncMessage
} from "./message.js";
import { RepairConfig, RepairManager } from "./repair/repair.js";

export const DEFAULT_BLOOM_FILTER_OPTIONS = {
  capacity: 10000,
  errorRate: 0.001
};

/**
 * Maximum number of repair requests to include in a single message
 */
const MAX_REPAIR_REQUESTS_PER_MESSAGE = 3;

const DEFAULT_CAUSAL_HISTORY_SIZE = 200;
const DEFAULT_POSSIBLE_ACKS_THRESHOLD = 2;

const log = new Logger("sds:message-channel");

export interface MessageChannelOptions {
  causalHistorySize?: number;
  /**
   * The time in milliseconds after which a message dependencies that could not
   * be resolved is marked as irretrievable.
   * Disabled if undefined or `0`.
   *
   * @default undefined because it is coupled to processTask calls frequency
   */
  timeoutForLostMessagesMs?: number;
  /**
   * How many possible acks does it take to consider it a definitive ack.
   */
  possibleAcksThreshold?: number;
  /**
   * Whether to enable SDS-R repair protocol.
   * @default true
   */
  enableRepair?: boolean;
  /**
   * SDS-R repair configuration. Only used if enableRepair is true.
   */
  repairConfig?: RepairConfig;
}

export type ILocalHistory = Pick<
  Array<ContentMessage>,
  "some" | "push" | "slice" | "find" | "length" | "findIndex"
>;

export class MessageChannel extends TypedEventEmitter<MessageChannelEvents> {
  public readonly channelId: ChannelId;
  public readonly senderId: ParticipantId;
  private lamportTimestamp: bigint;
  private filter: DefaultBloomFilter;
  private outgoingBuffer: ContentMessage[];
  private possibleAcks: Map<MessageId, number>;
  private incomingBuffer: Array<ContentMessage | SyncMessage>;
  private readonly localHistory: ILocalHistory;
  private timeReceived: Map<MessageId, number>;
  private readonly causalHistorySize: number;
  private readonly possibleAcksThreshold: number;
  private readonly timeoutForLostMessagesMs?: number;
  private readonly repairManager?: RepairManager;

  private tasks: Task[] = [];
  private handlers: Handlers = {
    [Command.Send]: async (
      params: ParamsByAction[Command.Send]
    ): Promise<void> => {
      await this._pushOutgoingMessage(params.payload, params.callback);
    },
    [Command.Receive]: async (
      params: ParamsByAction[Command.Receive]
    ): Promise<void> => {
      this._pushIncomingMessage(params.message);
    },
    [Command.SendEphemeral]: async (
      params: ParamsByAction[Command.SendEphemeral]
    ): Promise<void> => {
      await this._pushOutgoingEphemeralMessage(params.payload, params.callback);
    }
  };

  public constructor(
    channelId: ChannelId,
    senderId: ParticipantId,
    options: MessageChannelOptions = {},
    localHistory: ILocalHistory = new MemLocalHistory()
  ) {
    super();
    this.channelId = channelId;
    this.senderId = senderId;
    // Initialize channel lamport timestamp to current time in milliseconds.
    this.lamportTimestamp = BigInt(Date.now());
    this.filter = new DefaultBloomFilter(DEFAULT_BLOOM_FILTER_OPTIONS);
    this.outgoingBuffer = [];
    this.possibleAcks = new Map();
    this.incomingBuffer = [];
    this.localHistory = localHistory;
    this.causalHistorySize =
      options.causalHistorySize ?? DEFAULT_CAUSAL_HISTORY_SIZE;
    // TODO: this should be determined based on the bloom filter parameters and number of hashes
    this.possibleAcksThreshold =
      options.possibleAcksThreshold ?? DEFAULT_POSSIBLE_ACKS_THRESHOLD;
    this.timeReceived = new Map();
    this.timeoutForLostMessagesMs = options.timeoutForLostMessagesMs;

    // Only construct RepairManager if repair is enabled (default: true)
    if (options.enableRepair ?? true) {
      this.repairManager = new RepairManager(
        senderId,
        options.repairConfig,
        (event: string, detail: unknown) => {
          this.safeSendEvent(event as MessageChannelEvent, { detail });
        }
      );
    }
  }

  public static getMessageId(payload: Uint8Array): MessageId {
    return bytesToHex(sha256(payload));
  }

  /**
   * Processes all queued tasks sequentially to ensure proper message ordering.
   *
   * This method should be called periodically by the library consumer to execute
   * queued send/receive operations in the correct sequence.
   *
   * @example
   * ```typescript
   * const channel = new MessageChannel("my-channel");
   *
   * // Queue some operations
   * await channel.pushOutgoingMessage(payload, callback);
   * channel.pushIncomingMessage(incomingMessage);
   *
   * // Process all queued operations
   * await channel.processTasks();
   * ```
   *
   * @emits CustomEvent("taskError", { detail: { command, error, params } }
   * if any task fails, but continues processing remaining tasks
   */
  public async processTasks(): Promise<void> {
    while (this.tasks.length > 0) {
      const item = this.tasks.shift();
      if (!item) {
        continue;
      }

      await this.executeTask(item);
    }
  }

  /**
   * Queues a message to be sent on this channel.
   *
   * The message will be processed sequentially when processTasks() is called.
   * This ensures proper lamport timestamp ordering and causal history tracking.
   *
   * @param payload - The message content as a byte array
   * @param callback - callback function that should propagate the message
   * on the routing layer; `success` should be false if sending irremediably fails,
   * when set to true, the message is finalized into the channel locally.
   * @returns Promise that resolves when the message is queued (not sent)
   *
   * @example
   * ```typescript
   * const channel = new MessageChannel("chat-room");
   * const message = new TextEncoder().encode("Hello, world!");
   *
   * await channel.pushOutgoingMessage(message, async (processedMessage) => {
   *   console.log("Message processed:", processedMessage.messageId);
   *   return { success: true };
   * });
   *
   * // Actually send the message
   * await channel.processTasks();
   * ```
   *
   * @throws Error if the payload is empty
   */
  public pushOutgoingMessage(
    payload: Uint8Array,
    callback?: (processedMessage: ContentMessage) => Promise<{
      success: boolean;
      retrievalHint?: Uint8Array;
    }>
  ): void {
    if (!payload || !payload.length) {
      throw Error("Only messages with valid payloads are allowed");
    }
    this.tasks.push({
      command: Command.Send,
      params: {
        payload,
        callback
      }
    });
  }

  /**
   * Sends a short-lived message without synchronization or reliability requirements.
   *
   * Sends a message without a timestamp, causal history, or bloom filter.
   * Ephemeral messages are not added to the outgoing buffer.
   * Upon reception, ephemeral messages are delivered immediately without
   * checking for causal dependencies or including in the local log.
   *
   * See https://rfc.vac.dev/vac/raw/sds/#ephemeral-messages
   *
   * @param payload - The payload to send.
   * @param callback - A callback function that returns a boolean indicating whether the message was sent successfully.
   */
  public async pushOutgoingEphemeralMessage(
    payload: Uint8Array,
    callback?: (processedMessage: Message) => Promise<boolean>
  ): Promise<void> {
    this.tasks.push({
      command: Command.SendEphemeral,
      params: {
        payload,
        callback
      }
    });
  }

  /**
   * Queues a received message for processing.
   *
   * The message will be processed when processTasks() is called, ensuring
   * proper dependency resolution and causal ordering.
   *
   * @param message - The message to receive and process
   * @param retrievalHint - The retrieval hint for the message, provided by the transport layer
   * @example
   * ```typescript
   * const channel = new MessageChannel("chat-room");
   *
   * // Receive a message from the network
   * channel.pushIncomingMessage(incomingMessage);
   *
   * // Process the received message
   * await channel.processTasks();
   * ```
   */
  public pushIncomingMessage(
    message: Message,
    retrievalHint: Uint8Array | undefined
  ): void {
    message.retrievalHint = retrievalHint;

    this.tasks.push({
      command: Command.Receive,
      params: {
        message
      }
    });
  }

  /**
   * Processes messages in the incoming buffer, delivering those with satisfied dependencies.
   *
   * @returns The missing dependencies
   */
  public sweepIncomingBuffer(): HistoryEntry[] {
    const { buffer, missing } = this.incomingBuffer.reduce<{
      buffer: Array<ContentMessage | SyncMessage>;
      missing: Set<HistoryEntry>;
    }>(
      ({ buffer, missing }, message) => {
        log.info(
          this.senderId,
          "sweeping incoming buffer",
          message.messageId,
          message.causalHistory.map((ch) => ch.messageId)
        );
        const missingDependencies = message.causalHistory.filter(
          (messageHistoryEntry) =>
            !this.isMessageAvailable(messageHistoryEntry.messageId)
        );
        if (missingDependencies.length === 0) {
          if (isContentMessage(message) && this.deliverMessage(message)) {
            this.safeSendEvent(MessageChannelEvent.InMessageDelivered, {
              detail: message.messageId
            });
          }
          return { buffer, missing };
        }
        log.info(
          this.senderId,
          "message from incoming buffer",
          message.messageId,
          "is missing dependencies",
          missingDependencies.map(({ messageId, retrievalHint }) => {
            return { messageId, retrievalHint };
          })
        );

        // Optionally, if a message did not get its dependencies fulfilled after a predetermined amount of time,
        // they are marked as irretrievably lost (implicitly by removing it from the buffer without delivery)
        if (this.timeoutForLostMessagesMs) {
          const timeReceived = this.timeReceived.get(message.messageId);
          if (
            timeReceived &&
            Date.now() - timeReceived > this.timeoutForLostMessagesMs
          ) {
            this.safeSendEvent(MessageChannelEvent.InMessageLost, {
              detail: Array.from(missingDependencies)
            });

            // We deliver the message to resume participation in the log
            if (isContentMessage(message) && this.deliverMessage(message)) {
              this.safeSendEvent(MessageChannelEvent.InMessageDelivered, {
                detail: message.messageId
              });
            }
            // The message and its missing dependencies are dropped
            // from the incoming buffer
            return { buffer, missing };
          }
        }

        missingDependencies.forEach((dependency) => {
          missing.add(dependency);
        });
        return {
          buffer: buffer.concat(message),
          missing
        };
      },
      { buffer: new Array<ContentMessage>(), missing: new Set<HistoryEntry>() }
    );
    this.incomingBuffer = buffer;

    this.safeSendEvent(MessageChannelEvent.InMessageMissing, {
      detail: Array.from(missing)
    });

    return Array.from(missing);
  }

  // https://rfc.vac.dev/vac/raw/sds/#periodic-outgoing-buffer-sweep
  public sweepOutgoingBuffer(): {
    unacknowledged: ContentMessage[];
    possiblyAcknowledged: ContentMessage[];
  } {
    return this.outgoingBuffer.reduce<{
      unacknowledged: ContentMessage[];
      possiblyAcknowledged: ContentMessage[];
    }>(
      ({ unacknowledged, possiblyAcknowledged }, message) => {
        if (this.possibleAcks.has(message.messageId)) {
          return {
            unacknowledged,
            possiblyAcknowledged: possiblyAcknowledged.concat(message)
          };
        }
        return {
          unacknowledged: unacknowledged.concat(message),
          possiblyAcknowledged
        };
      },
      {
        unacknowledged: new Array<ContentMessage>(),
        possiblyAcknowledged: new Array<ContentMessage>()
      }
    );
  }

  /**
   * Sweep repair incoming buffer and rebroadcast messages ready for repair.
   * Per SDS-R spec: periodically check for repair responses that are due.
   *
   * @param callback - callback to rebroadcast the message
   * @returns Promise that resolves when all ready repairs have been sent
   */
  public async sweepRepairIncomingBuffer(
    callback?: (message: Message) => Promise<boolean>
  ): Promise<Message[]> {
    const repairsToSend =
      this.repairManager?.sweepIncomingBuffer(this.localHistory) ?? [];

    if (callback) {
      for (const message of repairsToSend) {
        try {
          await callback(message);
          log.info(
            this.senderId,
            "repair message rebroadcast",
            message.messageId
          );

          // Emit RepairResponseSent event
          this.safeSendEvent(MessageChannelEvent.RepairResponseSent, {
            detail: {
              messageId: message.messageId
            }
          });
        } catch (error) {
          log.error("Failed to rebroadcast repair message:", error);
        }
      }
    }

    return repairsToSend;
  }

  /**
   * Send a sync message to the SDS channel.
   *
   * Increments the lamport timestamp, constructs a `Message` object
   * with an empty load. Skips outgoing buffer, filter, and local log.
   *
   * See https://rfc.vac.dev/vac/raw/sds/#send-sync-message
   *
   * @param callback - A callback function that returns a boolean indicating whether the message was sent successfully.
   */
  public async pushOutgoingSyncMessage(
    callback?: (message: SyncMessage) => Promise<boolean>
  ): Promise<boolean> {
    this.lamportTimestamp = lamportTimestampIncrement(this.lamportTimestamp);

    // Get repair requests to include in sync message (SDS-R)
    const repairRequests =
      this.repairManager?.getRepairRequests(MAX_REPAIR_REQUESTS_PER_MESSAGE) ??
      [];

    const message = new SyncMessage(
      // does not need to be secure randomness
      `sync-${Math.random().toString(36).substring(2)}`,
      this.channelId,
      this.senderId,
      this.localHistory
        .slice(-this.causalHistorySize)
        .map(({ messageId, retrievalHint, senderId }) => {
          return { messageId, retrievalHint, senderId };
        }),
      this.lamportTimestamp,
      this.filter.toBytes(),
      undefined,
      repairRequests
    );

    if (
      (!message.causalHistory || message.causalHistory.length === 0) &&
      repairRequests.length === 0
    ) {
      log.info(
        this.senderId,
        "no causal history and no repair requests in sync message, aborting sending"
      );
      return false;
    }

    if (callback) {
      try {
        await callback(message);
        log.info(this.senderId, "sync message sent", message.messageId);
        this.safeSendEvent(MessageChannelEvent.OutSyncSent, {
          detail: message
        });

        // Emit RepairRequestSent event if repair requests were included
        if (repairRequests.length > 0) {
          this.safeSendEvent(MessageChannelEvent.RepairRequestSent, {
            detail: {
              messageIds: repairRequests.map((r) => r.messageId),
              carrierMessageId: message.messageId
            }
          });
        }

        return true;
      } catch (error) {
        log.error(
          "Callback execution failed in pushOutgoingSyncMessage:",
          error
        );
        throw error;
      }
    }
    // No problem encountered so returning true
    return true;
  }

  private _pushIncomingMessage(message: Message): void {
    if (message.channelId !== this.channelId) {
      log.warn("dropping message on different channel", message.channelId);
      return;
    }

    log.info(
      `${this.senderId} incoming message ${message.messageId}`,
      `retrieval hint: ${bytesToHex(message.retrievalHint ?? new Uint8Array())}`
    );
    const isDuplicate =
      message.content &&
      message.content.length > 0 &&
      this.timeReceived.has(message.messageId);

    if (isDuplicate) {
      log.info(
        this.senderId,
        "dropping dupe incoming message",
        message.messageId
      );
      return;
    }

    const isOwnOutgoingMessage = this.senderId === message.senderId;
    if (isOwnOutgoingMessage) {
      log.info(this.senderId, "ignoring own incoming message");
      return;
    }

    // Ephemeral messages SHOULD be delivered immediately
    if (isEphemeralMessage(message)) {
      log.info(this.senderId, "delivering ephemeral message");
      return;
    }
    if (!isSyncMessage(message) && !isContentMessage(message)) {
      log.error(
        this.senderId,
        "internal error, a message is neither sync nor ephemeral nor content, ignoring it",
        message
      );
      return;
    }
    if (isSyncMessage(message)) {
      this.safeSendEvent(MessageChannelEvent.InSyncReceived, {
        detail: message
      });
    } else {
      this.safeSendEvent(MessageChannelEvent.InMessageReceived, {
        detail: message
      });
    }

    // SDS-R: Handle received message in repair manager
    this.repairManager?.markMessageReceived(message.messageId);

    // SDS-R: Process incoming repair requests
    if (message.repairRequest && message.repairRequest.length > 0) {
      // Emit RepairRequestReceived event
      this.safeSendEvent(MessageChannelEvent.RepairRequestReceived, {
        detail: {
          messageIds: message.repairRequest.map((r) => r.messageId),
          fromSenderId: message.senderId
        }
      });

      this.repairManager?.processIncomingRepairRequests(
        message.repairRequest,
        this.localHistory
      );
    }

    this.reviewAckStatus(message);
    if (isContentMessage(message)) {
      this.filter.insert(message.messageId);
    }

    const missingDependencies = message.causalHistory.filter(
      (messageHistoryEntry) =>
        !this.isMessageAvailable(messageHistoryEntry.messageId)
    );

    if (missingDependencies.length > 0) {
      this.incomingBuffer.push(message);
      this.timeReceived.set(message.messageId, Date.now());
      log.info(
        this.senderId,
        "new incoming message",
        message.messageId,
        "is missing dependencies",
        missingDependencies.map((ch) => ch.messageId)
      );

      // SDS-R: Track missing dependencies in repair manager
      this.repairManager?.markDependenciesMissing(missingDependencies);

      this.safeSendEvent(MessageChannelEvent.InMessageMissing, {
        detail: Array.from(missingDependencies)
      });
    } else {
      if (isContentMessage(message) && this.deliverMessage(message)) {
        this.safeSendEvent(MessageChannelEvent.InMessageDelivered, {
          detail: message.messageId
        });
      }
    }
  }

  private async executeTask<A extends Command>(item: Task<A>): Promise<void> {
    try {
      const handler = this.handlers[item.command];
      await handler(item.params as ParamsByAction[A]);
    } catch (error) {
      log.error(`Task execution failed for command ${item.command}:`, error);
      this.dispatchEvent(
        new CustomEvent("taskError", {
          detail: { command: item.command, error, params: item.params }
        })
      );
      this.safeSendEvent(MessageChannelEvent.ErrorTask, {
        detail: { command: item.command, error, params: item.params }
      });
    }
  }

  private safeSendEvent<T extends MessageChannelEvent>(
    event: T,
    eventInit?: CustomEventInit
  ): void {
    try {
      this.dispatchEvent(new CustomEvent(event, eventInit));
    } catch (error) {
      log.error(`Failed to dispatch event ${event}:`, error);
    }
  }

  private async _pushOutgoingMessage(
    payload: Uint8Array,
    callback?: (message: ContentMessage) => Promise<{
      success: boolean;
      retrievalHint?: Uint8Array;
    }>
  ): Promise<void> {
    this.lamportTimestamp = lamportTimestampIncrement(this.lamportTimestamp);

    const messageId = MessageChannel.getMessageId(payload);

    // if same message id is in the outgoing buffer,
    // it means it's a retry, and we need to resend the same message
    // to ensure we do not create a cyclic dependency of any sort.

    let message = this.outgoingBuffer.find(
      (m: Message) => m.messageId === messageId
    );

    // It's a new message
    if (!message) {
      log.info(this.senderId, "sending new message", messageId);

      // Get repair requests to include in the message (SDS-R)
      const repairRequests =
        this.repairManager?.getRepairRequests(
          MAX_REPAIR_REQUESTS_PER_MESSAGE
        ) ?? [];

      message = new ContentMessage(
        messageId,
        this.channelId,
        this.senderId,
        this.localHistory
          .slice(-this.causalHistorySize)
          .map(({ messageId, retrievalHint, senderId }) => {
            return { messageId, retrievalHint, senderId };
          }),
        this.lamportTimestamp,
        this.filter.toBytes(),
        payload,
        repairRequests
      );

      this.outgoingBuffer.push(message);
    } else {
      log.info(this.senderId, "resending message", messageId);
    }

    if (callback) {
      try {
        const { success, retrievalHint } = await callback(message);
        // isContentMessage should always be true as `this.lamportTimestamp` has been
        // used to create the message
        if (success && isContentMessage(message)) {
          message.retrievalHint = retrievalHint;
          this.filter.insert(messageId);
          this.localHistory.push(message);
          this.timeReceived.set(messageId, Date.now());
          this.safeSendEvent(MessageChannelEvent.OutMessageSent, {
            detail: message
          });
        }
      } catch (error) {
        log.error("Callback execution failed in _pushOutgoingMessage:", error);
        throw error;
      }
    }
  }

  private async _pushOutgoingEphemeralMessage(
    payload: Uint8Array,
    callback?: (message: EphemeralMessage) => Promise<boolean>
  ): Promise<void> {
    const message = new EphemeralMessage(
      MessageChannel.getMessageId(payload),
      this.channelId,
      this.senderId,
      [],
      undefined,
      undefined,
      payload
    );

    if (callback) {
      try {
        await callback(message);
      } catch (error) {
        log.error(
          "Callback execution failed in _pushOutgoingEphemeralMessage:",
          error
        );
        throw error;
      }
    }
  }

  /**
   * Check if a message is available (either in localHistory or incomingBuffer)
   * This prevents treating messages as "missing" when they've already been received
   * but are waiting in the incoming buffer for their dependencies.
   *
   * @param messageId - The ID of the message to check
   * @private
   */
  private isMessageAvailable(messageId: MessageId): boolean {
    // Check if in local history
    if (this.localHistory.some((m) => m.messageId === messageId)) {
      return true;
    }
    // Check if in incoming buffer (already received, waiting for dependencies)
    if (this.incomingBuffer.some((m) => m.messageId === messageId)) {
      return true;
    }
    return false;
  }

  /**
   * Return true if the message was "delivered"
   *
   * @param message
   * @private
   */
  // See https://rfc.vac.dev/vac/raw/sds/#deliver-message
  private deliverMessage(message: ContentMessage): boolean {
    if (!isContentMessage(message)) {
      // Messages with empty content are sync messages.
      // Messages with no timestamp are ephemeral messages.
      // They do not need to be "delivered".
      // They are not added to the local log or bloom filter.
      return false;
    }

    log.info(
      this.senderId,
      "delivering message",
      message.messageId,
      message.retrievalHint
    );
    if (message.lamportTimestamp > this.lamportTimestamp) {
      this.lamportTimestamp = message.lamportTimestamp;
    }

    // Check if the entry is already present
    const existingHistoryEntry = this.localHistory.find(
      ({ messageId }) => messageId === message.messageId
    );

    // The history entry is already present, no need to re-add
    if (existingHistoryEntry) {
      return true;
    }

    if (!message.retrievalHint) {
      log.warn("message delivered without a retrieval hint", message.messageId);
    }

    this.localHistory.push(message);

    return true;
  }

  // For each received message (including sync messages), inspect the causal history and bloom filter
  // to determine the acknowledgement status of messages in the outgoing buffer.
  // See https://rfc.vac.dev/vac/raw/sds/#review-ack-status
  private reviewAckStatus(receivedMessage: Message): void {
    log.info(
      this.senderId,
      "reviewing ack status using causal history:",
      receivedMessage.causalHistory.map((ch) => ch.messageId)
    );
    log.info(
      this.senderId,
      "current outgoing buffer:",
      this.outgoingBuffer.map((b) => b.messageId)
    );
    receivedMessage.causalHistory.forEach(({ messageId }) => {
      this.outgoingBuffer = this.outgoingBuffer.filter(
        ({ messageId: bufferMessageId }) => {
          if (bufferMessageId !== messageId) {
            return true;
          }
          log.info(this.senderId, "message acknowledged", messageId);
          this.safeSendEvent(MessageChannelEvent.OutMessageAcknowledged, {
            detail: messageId
          });
          return false;
        }
      );
    });

    if (!receivedMessage.bloomFilter) {
      return;
    }

    const messageBloomFilter = DefaultBloomFilter.fromBytes(
      receivedMessage.bloomFilter,
      this.filter.options
    );
    this.outgoingBuffer = this.outgoingBuffer.filter((message) => {
      if (!messageBloomFilter.lookup(message.messageId)) {
        return true;
      }
      // If a message appears as possibly acknowledged in multiple received bloom filters,
      // the participant MAY mark it as acknowledged based on probabilistic grounds,
      // taking into account the bloom filter size and hash number.
      const count = (this.possibleAcks.get(message.messageId) ?? 0) + 1;
      if (count < this.possibleAcksThreshold) {
        this.possibleAcks.set(message.messageId, count);
        log.info(
          this.senderId,
          "message possibly acknowledged",
          message.messageId,
          count
        );
        this.safeSendEvent(MessageChannelEvent.OutMessagePossiblyAcknowledged, {
          detail: {
            messageId: message.messageId,
            count
          }
        });
        // Not enough possible acks to acknowledge it, keep it in buffer
        return true;
      }
      // Enough possible acks for it to be acknowledged
      this.possibleAcks.delete(message.messageId);
      log.info(this.senderId, "message acknowledged", message.messageId, count);
      this.safeSendEvent(MessageChannelEvent.OutMessageAcknowledged, {
        detail: message.messageId
      });
      return false;
    });
  }
}

export function lamportTimestampIncrement(lamportTimestamp: bigint): bigint {
  const now = BigInt(Date.now());
  lamportTimestamp++;
  if (now > lamportTimestamp) {
    return now;
  }
  return lamportTimestamp;
}
