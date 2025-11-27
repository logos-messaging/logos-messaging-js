import _ from "lodash";

import { type ChannelId, ContentMessage, isContentMessage } from "./message.js";
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
  length: number;
  push(...items: ContentMessage[]): number;
  some(
    predicate: (
      value: ContentMessage,
      index: number,
      array: ContentMessage[]
    ) => unknown,
    thisArg?: any
  ): boolean;
  slice(start?: number, end?: number): ContentMessage[];
  find(
    predicate: (
      value: ContentMessage,
      index: number,
      obj: ContentMessage[]
    ) => unknown,
    thisArg?: any
  ): ContentMessage | undefined;
  findIndex(
    predicate: (
      value: ContentMessage,
      index: number,
      obj: ContentMessage[]
    ) => unknown,
    thisArg?: any
  ): number;
}

export type MemLocalHistoryOptions = {
  storage?: ChannelId | PersistentStorage;
  maxSize?: number;
};

export class MemLocalHistory implements ILocalHistory {
  private items: ContentMessage[] = [];
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
    } else if (typeof storage === "string") {
      this.storage = PersistentStorage.create(storage);
    } else {
      this.storage = undefined;
    }

    this.load();
  }

  public get length(): number {
    return this.items.length;
  }

  public push(...items: ContentMessage[]): number {
    for (const item of items) {
      this.validateMessage(item);
    }

    // Add new items and sort by timestamp, ensuring uniqueness by messageId
    // The valueOf() method on ContentMessage enables native < operator sorting
    const combinedItems = [...this.items, ...items];

    // Sort by timestamp (using valueOf() which creates timestamp_messageId string)
    combinedItems.sort((a, b) => a.valueOf().localeCompare(b.valueOf()));

    // Remove duplicates by messageId while maintaining order
    this.items = _.uniqBy(combinedItems, "messageId");

    // Let's drop older messages if max length is reached
    if (this.length > this.maxSize) {
      const numItemsToRemove = this.length - this.maxSize;
      this.items.splice(0, numItemsToRemove);
    }

    this.save();

    return this.items.length;
  }

  public some(
    predicate: (
      value: ContentMessage,
      index: number,
      array: ContentMessage[]
    ) => unknown,
    thisArg?: any
  ): boolean {
    return this.items.some(predicate, thisArg);
  }

  public slice(start?: number, end?: number): ContentMessage[] {
    return this.items.slice(start, end);
  }

  public find(
    predicate: (
      value: ContentMessage,
      index: number,
      obj: ContentMessage[]
    ) => unknown,
    thisArg?: any
  ): ContentMessage | undefined {
    return this.items.find(predicate, thisArg);
  }

  public findIndex(
    predicate: (
      value: ContentMessage,
      index: number,
      obj: ContentMessage[]
    ) => unknown,
    thisArg?: any
  ): number {
    return this.items.findIndex(predicate, thisArg);
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
    }
  }
}
