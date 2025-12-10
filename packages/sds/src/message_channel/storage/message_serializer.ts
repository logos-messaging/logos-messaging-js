import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

import { ContentMessage, HistoryEntry } from "../message.js";

export type StoredCausalEntry = {
  messageId: string;
  retrievalHint?: string;
};

export type StoredContentMessage = {
  messageId: string;
  channelId: string;
  senderId: string;
  lamportTimestamp: string;
  causalHistory: StoredCausalEntry[];
  bloomFilter?: string;
  content: string;
  retrievalHint?: string;
};

export class MessageSerializer {
  public static serializeContentMessage(
    message: ContentMessage
  ): StoredContentMessage {
    return {
      messageId: message.messageId,
      channelId: message.channelId,
      senderId: message.senderId,
      lamportTimestamp: message.lamportTimestamp.toString(),
      causalHistory: message.causalHistory.map((entry) =>
        MessageSerializer.serializeCausalEntry(entry)
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
          MessageSerializer.deserializeCausalEntry(entry)
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

  public static serializeCausalEntry(entry: HistoryEntry): StoredCausalEntry {
    return {
      messageId: entry.messageId,
      retrievalHint: entry.retrievalHint
        ? bytesToHex(entry.retrievalHint)
        : undefined
    };
  }

  public static deserializeCausalEntry(entry: StoredCausalEntry): HistoryEntry {
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
