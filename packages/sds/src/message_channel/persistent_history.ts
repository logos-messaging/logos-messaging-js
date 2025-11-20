import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

import { ILocalHistory, MemLocalHistory } from "./mem_local_history.js";
import { ChannelId, ContentMessage, HistoryEntry } from "./message.js";

export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistentHistoryOptions {
  channelId: ChannelId;
  storage?: HistoryStorage;
  storageKeyPrefix?: string;
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

const HISTORY_STORAGE_PREFIX = "waku:sds:history:";

/**
 * Persists the SDS local history in a browser/localStorage compatible backend.
 *
 * If no storage backend is available, this behaves like {@link MemLocalHistory}.
 */
export class PersistentHistory implements ILocalHistory {
  private readonly storage?: HistoryStorage;
  private readonly storageKey: string;
  private readonly memory: MemLocalHistory;

  public constructor(options: PersistentHistoryOptions) {
    this.memory = new MemLocalHistory();
    this.storage = options.storage ?? getDefaultHistoryStorage();
    this.storageKey = `${HISTORY_STORAGE_PREFIX}${options.storageKeyPrefix}:${options.channelId}`;
    this.restore();
  }

  public get length(): number {
    return this.memory.length;
  }

  public push(...items: ContentMessage[]): number {
    const length = this.memory.push(...items);
    this.persist();
    return length;
  }

  public some(
    predicate: (
      value: ContentMessage,
      index: number,
      array: ContentMessage[]
    ) => unknown,
    thisArg?: any
  ): boolean {
    return this.memory.some(predicate, thisArg);
  }

  public slice(start?: number, end?: number): ContentMessage[] {
    return this.memory.slice(start, end);
  }

  public find(
    predicate: (
      value: ContentMessage,
      index: number,
      obj: ContentMessage[]
    ) => unknown,
    thisArg?: any
  ): ContentMessage | undefined {
    return this.memory.find(predicate, thisArg);
  }

  public findIndex(
    predicate: (
      value: ContentMessage,
      index: number,
      obj: ContentMessage[]
    ) => unknown,
    thisArg?: any
  ): number {
    return this.memory.findIndex(predicate, thisArg);
  }

  private persist(): void {
    if (!this.storage) {
      return;
    }
    try {
      const payload = JSON.stringify(
        this.memory.slice(0).map(serializeContentMessage)
      );
      this.storage.setItem(this.storageKey, payload);
    } catch {
      // Ignore persistence errors (e.g. quota exceeded).
    }
  }

  private restore(): void {
    if (!this.storage) {
      return;
    }

    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) {
        return;
      }

      const stored = JSON.parse(raw) as StoredContentMessage[];
      const messages = stored
        .map(deserializeContentMessage)
        .filter((message): message is ContentMessage => Boolean(message));
      if (messages.length) {
        this.memory.push(...messages);
      }
    } catch {
      try {
        this.storage.removeItem(this.storageKey);
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}

export const getDefaultHistoryStorage = (): HistoryStorage | undefined => {
  try {
    if (typeof localStorage === "undefined") {
      return undefined;
    }

    const probeKey = `${HISTORY_STORAGE_PREFIX}__probe__`;
    localStorage.setItem(probeKey, probeKey);
    localStorage.removeItem(probeKey);
    return localStorage;
  } catch {
    return undefined;
  }
};

const serializeHistoryEntry = (entry: HistoryEntry): StoredHistoryEntry => ({
  messageId: entry.messageId,
  retrievalHint: entry.retrievalHint
    ? bytesToHex(entry.retrievalHint)
    : undefined
});

const deserializeHistoryEntry = (entry: StoredHistoryEntry): HistoryEntry => ({
  messageId: entry.messageId,
  retrievalHint: entry.retrievalHint
    ? hexToBytes(entry.retrievalHint)
    : undefined
});

const serializeContentMessage = (
  message: ContentMessage
): StoredContentMessage => ({
  messageId: message.messageId,
  channelId: message.channelId,
  senderId: message.senderId,
  lamportTimestamp: message.lamportTimestamp.toString(),
  causalHistory: message.causalHistory.map(serializeHistoryEntry),
  bloomFilter: toHex(message.bloomFilter),
  content: bytesToHex(new Uint8Array(message.content)),
  retrievalHint: toHex(message.retrievalHint)
});

const deserializeContentMessage = (
  record: StoredContentMessage
): ContentMessage | undefined => {
  try {
    const content = hexToBytes(record.content);
    return new ContentMessage(
      record.messageId,
      record.channelId,
      record.senderId,
      record.causalHistory.map(deserializeHistoryEntry),
      BigInt(record.lamportTimestamp),
      fromHex(record.bloomFilter),
      content,
      [],
      fromHex(record.retrievalHint)
    );
  } catch {
    return undefined;
  }
};

const toHex = (
  data?: Uint8Array | Uint8Array<ArrayBufferLike>
): string | undefined => {
  if (!data || data.length === 0) {
    return undefined;
  }
  return bytesToHex(data instanceof Uint8Array ? data : new Uint8Array(data));
};

const fromHex = (value?: string): Uint8Array | undefined => {
  if (!value) {
    return undefined;
  }
  return hexToBytes(value);
};
