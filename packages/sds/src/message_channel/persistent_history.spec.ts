import { expect } from "chai";

import { ContentMessage } from "./message.js";
import { HistoryStorage, PersistentHistory } from "./persistent_history.js";

class MemoryStorage implements HistoryStorage {
  private readonly store = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  public removeItem(key: string): void {
    this.store.delete(key);
  }
}

const channelId = "channel-1";

const createMessage = (id: string, timestamp: number): ContentMessage => {
  return new ContentMessage(
    id,
    channelId,
    "sender",
    [],
    BigInt(timestamp),
    undefined,
    new Uint8Array([timestamp]),
    undefined
  );
};

describe("PersistentHistory", () => {
  it("persists and restores messages", () => {
    const storage = new MemoryStorage();
    const history = new PersistentHistory({ channelId, storage });

    history.push(createMessage("msg-1", 1));
    history.push(createMessage("msg-2", 2));

    const restored = new PersistentHistory({ channelId, storage });

    expect(restored.length).to.equal(2);
    expect(restored.slice(0).map((msg) => msg.messageId)).to.deep.equal([
      "msg-1",
      "msg-2"
    ]);
  });

  it("behaves like memory history when storage is unavailable", () => {
    const history = new PersistentHistory({ channelId, storage: undefined });

    history.push(createMessage("msg-3", 3));

    expect(history.length).to.equal(1);
    expect(history.slice(0)[0].messageId).to.equal("msg-3");
  });
});
