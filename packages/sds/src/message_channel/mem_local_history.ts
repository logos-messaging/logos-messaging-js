import { Logger } from "@waku/utils";
import _ from "lodash";

import {
  type ChannelId,
  ContentMessage,
  type HistoryEntry,
  isContentMessage
} from "./message.js";
import { PersistentStorage } from "./persistent_storage.js";

export const DEFAULT_MAX_LENGTH = 10_000;

/**
 * In-Memory implementation of a local history of messages.
 *
 * Messages are store in SDS chronological order:
 * - messages[0] is the oldest message
 * - messages[n] is the newest message
 *
 * Only stores content message: `message.lamportTimestamp` and `message.content` are present.
 *
 * Oldest messages are dropped when `maxLength` is reached.
 * If an array of items longer than `maxLength` is pushed, dropping will happen
 * at next push.
 */
export interface ILocalHistory {
  readonly size: number;
  addMessages(...messages: ContentMessage[]): void;
  hasMessage(messageId: string): boolean;
  getMessage(messageId: string): ContentMessage | undefined;
  getRecentMessages(count: number): ContentMessage[];
  getAllMessages(): ContentMessage[];
  findMissingDependencies(entries: HistoryEntry[]): HistoryEntry[];
}

export type MemLocalHistoryOptions = {
  storage?: ChannelId | PersistentStorage;
  maxSize?: number;
};

const log = new Logger("sds:local-history");

export class MemLocalHistory implements ILocalHistory {
  private items: ContentMessage[] = [];
  private messageIndex: Map<string, ContentMessage> = new Map();
  private readonly storage?: PersistentStorage;
  private readonly maxSize: number;

  /**
   * Construct a new in-memory local history.
   *
   * @param opts Configuration object.
   *   - storage: Optional persistent storage backend for message persistence or channelId to use with PersistentStorage.
   *   - maxSize: The maximum number of messages to store. Optional, defaults to DEFAULT_MAX_LENGTH.
   */
  public constructor(opts: MemLocalHistoryOptions = {}) {
    const { storage, maxSize } = opts;
    this.maxSize = maxSize ?? DEFAULT_MAX_LENGTH;
    if (storage instanceof PersistentStorage) {
      this.storage = storage;
      log.info("Using explicit persistent storage");
    } else if (typeof storage === "string") {
      this.storage = PersistentStorage.create(storage);
      log.info("Creating persistent storage for channel", storage);
    } else {
      this.storage = undefined;
      log.info("Using in-memory storage");
    }

    this.load();
  }

  public get size(): number {
    return this.items.length;
  }

  public addMessages(...messages: ContentMessage[]): void {
    for (const message of messages) {
      this.validateMessage(message);
    }

    // Add new items and sort by timestamp, ensuring uniqueness by messageId
    // The valueOf() method on ContentMessage enables native < operator sorting
    const combinedItems = [...this.items, ...messages];

    // Sort by timestamp (using valueOf() which creates timestamp_messageId string)
    combinedItems.sort((a, b) => a.valueOf().localeCompare(b.valueOf()));

    // Remove duplicates by messageId while maintaining order
    this.items = _.uniqBy(combinedItems, "messageId");

    this.rebuildIndex();

    // Let's drop older messages if max length is reached
    if (this.size > this.maxSize) {
      const numItemsToRemove = this.size - this.maxSize;
      const removedItems = this.items.splice(0, numItemsToRemove);
      for (const item of removedItems) {
        this.messageIndex.delete(item.messageId);
      }
    }

    this.save();
  }

  public hasMessage(messageId: string): boolean {
    return this.messageIndex.has(messageId);
  }

  public getRecentMessages(count: number): ContentMessage[] {
    return this.items.slice(-count);
  }

  public getAllMessages(): ContentMessage[] {
    return [...this.items];
  }

  public getMessage(messageId: string): ContentMessage | undefined {
    return this.messageIndex.get(messageId);
  }

  public findMissingDependencies(entries: HistoryEntry[]): HistoryEntry[] {
    return entries.filter((entry) => !this.messageIndex.has(entry.messageId));
  }

  private rebuildIndex(): void {
    this.messageIndex.clear();
    for (const message of this.items) {
      this.messageIndex.set(message.messageId, message);
    }
  }

  private validateMessage(message: ContentMessage): void {
    if (!isContentMessage(message)) {
      throw new Error(
        "Message must have lamportTimestamp and content defined, sync and ephemeral messages cannot be stored"
      );
    }
  }

  private save(): void {
    this.storage?.save(this.items);
  }

  private load(): void {
    const messages = this.storage?.load() ?? [];
    if (messages.length > 0) {
      this.items = messages;
      this.rebuildIndex();
    }
  }
}
