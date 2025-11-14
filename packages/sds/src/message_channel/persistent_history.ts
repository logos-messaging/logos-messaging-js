import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

import { MemLocalHistory } from "./mem_local_history.js";
import { ChannelId, ContentMessage, HistoryEntry } from "./message.js";

export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistentHistoryOptions {
  channelId: ChannelId;
  storage?: HistoryStorage;
  storageKey?: string;
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
export class PersistentHistory extends MemLocalHistory {
  private readonly storage?: HistoryStorage;
  private readonly storageKey: string;

  public constructor(options: PersistentHistoryOptions) {
    super();
    this.storage = options.storage ?? getDefaultHistoryStorage();
    this.storageKey =
      options.storageKey ?? `${HISTORY_STORAGE_PREFIX}${options.channelId}`;
    this.restore();
  }

  public override push(...items: ContentMessage[]): number {
    const length = super.push(...items);
    this.persist();
    return length;
  }

  private persist(): void {
    if (!this.storage) {
      return;
    }
    try {
      const payload = JSON.stringify(
        this.slice(0).map(serializeContentMessage)
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
        super.push(...messages);
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
