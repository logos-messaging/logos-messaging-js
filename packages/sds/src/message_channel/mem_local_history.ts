import _ from "lodash";

import { ContentMessage, isContentMessage } from "./message.js";

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
export class MemLocalHistory {
  private items: ContentMessage[] = [];

  /**
   * Construct a new in-memory local history
   *
   * @param maxLength The maximum number of message to store.
   */
  public constructor(private maxLength: number = DEFAULT_MAX_LENGTH) {}

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
    if (this.length > this.maxLength) {
      const numItemsToRemove = this.length - this.maxLength;
      this.items.splice(0, numItemsToRemove);
    }

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
}
