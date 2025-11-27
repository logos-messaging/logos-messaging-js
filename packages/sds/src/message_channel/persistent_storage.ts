import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { Logger } from "@waku/utils";

import { ChannelId, ContentMessage, HistoryEntry } from "./message.js";

const log = new Logger("sds:persistent-storage");

const HISTORY_STORAGE_PREFIX = "waku:sds:history:";

export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type StoredHistoryEntry = {
  messageId: string;
  retrievalHint?: string;
};

type StoredContentMessage = {
  messageId: string;
  channelId: string;
  senderId: string;
  lamportTimestamp: string;
  causalHistory: StoredHistoryEntry[];
  bloomFilter?: string;
  content: string;
  retrievalHint?: string;
};

/**
 * Persistent storage for message history.
 */
export class PersistentStorage {
  private readonly storageKey: string;

  /**
   * Creates a PersistentStorage for a channel, or returns undefined if no storage is available.
   * If no storage is provided, attempts to use global localStorage (if available).
   * Returns undefined if no storage is available.
   */
  public static create(
    channelId: ChannelId,
    storage?: HistoryStorage
  ): PersistentStorage | undefined {
    storage =
      storage ??
      (typeof localStorage !== "undefined" ? localStorage : undefined);
    if (!storage) {
      log.info(
        `No storage available. Messages will not persist across sessions.
        If you're using NodeJS, you can provide a storage backend using the storage parameter.`
      );
      return undefined;
    }
    return new PersistentStorage(channelId, storage);
  }

  private constructor(
    channelId: ChannelId,
    private readonly storage: HistoryStorage
  ) {
    this.storageKey = `${HISTORY_STORAGE_PREFIX}${channelId}`;
  }

  public save(messages: ContentMessage[]): void {
    try {
      const payload = JSON.stringify(
        messages.map((msg) => MessageSerializer.serializeContentMessage(msg))
      );
      this.storage.setItem(this.storageKey, payload);
    } catch (error) {
      log.error("Failed to save messages to storage:", error);
    }
  }

  public load(): ContentMessage[] {
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) {
        return [];
      }

      const stored = JSON.parse(raw) as StoredContentMessage[];
      return stored
        .map((record) => MessageSerializer.deserializeContentMessage(record))
        .filter((message): message is ContentMessage => Boolean(message));
    } catch (error) {
      log.error("Failed to load messages from storage:", error);
      this.storage.removeItem(this.storageKey);
      return [];
    }
  }
}

class MessageSerializer {
  public static serializeContentMessage(
    message: ContentMessage
  ): StoredContentMessage {
    return {
      messageId: message.messageId,
      channelId: message.channelId,
      senderId: message.senderId,
      lamportTimestamp: message.lamportTimestamp.toString(),
      causalHistory: message.causalHistory.map((entry) =>
        MessageSerializer.serializeHistoryEntry(entry)
      ),
      bloomFilter: MessageSerializer.toHex(message.bloomFilter),
      content: bytesToHex(new Uint8Array(message.content)),
      retrievalHint: MessageSerializer.toHex(message.retrievalHint)
    };
  }

  public static deserializeContentMessage(
    record: StoredContentMessage
  ): ContentMessage | undefined {
    try {
      const content = hexToBytes(record.content);
      return new ContentMessage(
        record.messageId,
        record.channelId,
        record.senderId,
        record.causalHistory.map((entry) =>
          MessageSerializer.deserializeHistoryEntry(entry)
        ),
        BigInt(record.lamportTimestamp),
        MessageSerializer.fromHex(record.bloomFilter),
        content,
        [],
        MessageSerializer.fromHex(record.retrievalHint)
      );
    } catch {
      return undefined;
    }
  }

  public static serializeHistoryEntry(entry: HistoryEntry): StoredHistoryEntry {
    return {
      messageId: entry.messageId,
      retrievalHint: entry.retrievalHint
        ? bytesToHex(entry.retrievalHint)
        : undefined
    };
  }

  public static deserializeHistoryEntry(
    entry: StoredHistoryEntry
  ): HistoryEntry {
    return {
      messageId: entry.messageId,
      retrievalHint: entry.retrievalHint
        ? hexToBytes(entry.retrievalHint)
        : undefined
    };
  }

  private static toHex(
    data?: Uint8Array | Uint8Array<ArrayBufferLike>
  ): string | undefined {
    if (!data || data.length === 0) {
      return undefined;
    }
    return bytesToHex(data instanceof Uint8Array ? data : new Uint8Array(data));
  }

  private static fromHex(value?: string): Uint8Array | undefined {
    if (!value) {
      return undefined;
    }
    return hexToBytes(value);
  }
}
