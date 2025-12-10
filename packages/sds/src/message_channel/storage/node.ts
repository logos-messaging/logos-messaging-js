import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { Logger } from "@waku/utils";

import { ContentMessage } from "../message.js";

import {
  MessageSerializer,
  StoredContentMessage
} from "./message_serializer.js";

const log = new Logger("sds:storage");

/**
 * Node.js file-based storage for message persistence.
 */
export class Storage {
  private readonly filePath: string;

  public constructor(storagePrefix: string, basePath: string = ".waku") {
    this.filePath = join(basePath, `${storagePrefix}.json`);
  }

  public save(messages: ContentMessage[]): void {
    try {
      const payload = JSON.stringify(
        messages.map((msg) => MessageSerializer.serializeContentMessage(msg)),
        null,
        2
      );
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, payload, "utf-8");
    } catch (error) {
      log.error("Failed to save messages to storage:", error);
    }
  }

  public load(): ContentMessage[] {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      if (!raw) {
        return [];
      }

      const stored = JSON.parse(raw) as StoredContentMessage[];
      return stored
        .map((record) => MessageSerializer.deserializeContentMessage(record))
        .filter((message): message is ContentMessage => Boolean(message));
    } catch (error: unknown) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code !== "ENOENT"
      ) {
        log.error("Failed to load messages from storage:", error);
      }
      return [];
    }
  }
}
