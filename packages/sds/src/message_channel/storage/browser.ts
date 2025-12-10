import { Logger } from "@waku/utils";

import { ContentMessage } from "../message.js";

import {
  MessageSerializer,
  StoredContentMessage
} from "./message_serializer.js";

const log = new Logger("sds:storage");

const STORAGE_PREFIX = "waku:sds:storage:";

/**
 * Browser localStorage wrapper for message persistence.
 */
export class Storage {
  private readonly storageKey: string;

  public constructor(storagePrefix: string) {
    this.storageKey = `${STORAGE_PREFIX}${storagePrefix}`;
  }

  public save(messages: ContentMessage[]): void {
    try {
      const payload = JSON.stringify(
        messages.map((msg) => MessageSerializer.serializeContentMessage(msg))
      );
      localStorage.setItem(this.storageKey, payload);
    } catch (error) {
      log.error("Failed to save messages to storage:", error);
    }
  }

  public load(): ContentMessage[] {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        return [];
      }

      const stored = JSON.parse(raw) as StoredContentMessage[];
      return stored
        .map((record) => MessageSerializer.deserializeContentMessage(record))
        .filter((message): message is ContentMessage => Boolean(message));
    } catch (error) {
      log.error("Failed to load messages from storage:", error);
      localStorage.removeItem(this.storageKey);
      return [];
    }
  }
}
