import { expect } from "chai";

import { LocalHistory } from "./local_history.js";
import { ContentMessage } from "./message.js";
import { HistoryStorage, PersistentStorage } from "./persistent_storage.js";

const channelId = "channel-1";

describe("PersistentStorage", () => {
  describe("Explicit storage", () => {
    it("persists and restores messages", () => {
      const storage = new MemoryStorage();
      const persistentStorage = PersistentStorage.create(channelId, storage);

      expect(persistentStorage).to.not.be.undefined;

      const history1 = new LocalHistory({ storage: persistentStorage });
      history1.push(createMessage("msg-1", 1));
      history1.push(createMessage("msg-2", 2));

      const history2 = new LocalHistory({ storage: persistentStorage });

      expect(history2.length).to.equal(2);
      expect(history2.slice(0).map((msg) => msg.messageId)).to.deep.equal([
        "msg-1",
        "msg-2"
      ]);
    });

    it("uses in-memory only when no storage is provided", () => {
      const history = new LocalHistory({ maxSize: 100 });
      history.push(createMessage("msg-3", 3));

      expect(history.length).to.equal(1);
      expect(history.slice(0)[0].messageId).to.equal("msg-3");

      const history2 = new LocalHistory({ maxSize: 100 });
      expect(history2.length).to.equal(0);
    });

    it("handles corrupt data in storage gracefully", () => {
      const storage = new MemoryStorage();
      // Corrupt data
      storage.setItem("waku:sds:history:channel-1", "{ invalid json }");

      const persistentStorage = PersistentStorage.create(channelId, storage);
      const history = new LocalHistory({ storage: persistentStorage });

      expect(history.length).to.equal(0);

      // Corrupt data is not saved
      expect(storage.getItem("waku:sds:history:channel-1")).to.equal(null);
    });

    it("isolates history by channel ID", () => {
      const storage = new MemoryStorage();

      const storage1 = PersistentStorage.create("channel-1", storage);
      const storage2 = PersistentStorage.create("channel-2", storage);

      const history1 = new LocalHistory({ storage: storage1 });
      const history2 = new LocalHistory({ storage: storage2 });

      history1.push(createMessage("msg-1", 1));
      history2.push(createMessage("msg-2", 2));

      expect(history1.length).to.equal(1);
      expect(history1.slice(0)[0].messageId).to.equal("msg-1");

      expect(history2.length).to.equal(1);
      expect(history2.slice(0)[0].messageId).to.equal("msg-2");

      expect(storage.getItem("waku:sds:history:channel-1")).to.not.be.null;
      expect(storage.getItem("waku:sds:history:channel-2")).to.not.be.null;
    });

    it("saves messages after each push", () => {
      const storage = new MemoryStorage();
      const persistentStorage = PersistentStorage.create(channelId, storage);
      const history = new LocalHistory({ storage: persistentStorage });

      expect(storage.getItem("waku:sds:history:channel-1")).to.be.null;

      history.push(createMessage("msg-1", 1));

      expect(storage.getItem("waku:sds:history:channel-1")).to.not.be.null;

      const saved = JSON.parse(storage.getItem("waku:sds:history:channel-1")!);
      expect(saved).to.have.lengthOf(1);
      expect(saved[0].messageId).to.equal("msg-1");
    });

    it("loads messages on initialization", () => {
      const storage = new MemoryStorage();
      const persistentStorage1 = PersistentStorage.create(channelId, storage);
      const history1 = new LocalHistory({ storage: persistentStorage1 });

      history1.push(createMessage("msg-1", 1));
      history1.push(createMessage("msg-2", 2));
      history1.push(createMessage("msg-3", 3));

      const persistentStorage2 = PersistentStorage.create(channelId, storage);
      const history2 = new LocalHistory({ storage: persistentStorage2 });

      expect(history2.length).to.equal(3);
      expect(history2.slice(0).map((m) => m.messageId)).to.deep.equal([
        "msg-1",
        "msg-2",
        "msg-3"
      ]);
    });
  });

  describe("Node.js only (no localStorage)", () => {
    before(function () {
      if (typeof localStorage !== "undefined") {
        this.skip();
      }
    });

    it("returns undefined when no storage is available", () => {
      const persistentStorage = PersistentStorage.create(channelId, undefined);

      expect(persistentStorage).to.equal(undefined);
    });
  });

  describe("Browser only (localStorage)", () => {
    before(function () {
      if (typeof localStorage === "undefined") {
        this.skip();
      }
    });

    it("persists and restores messages with channelId", () => {
      const testChannelId = `test-${Date.now()}`;
      const history1 = new LocalHistory({ storage: testChannelId });
      history1.push(createMessage("msg-1", 1));
      history1.push(createMessage("msg-2", 2));

      const history2 = new LocalHistory({ storage: testChannelId });

      expect(history2.length).to.equal(2);
      expect(history2.slice(0).map((msg) => msg.messageId)).to.deep.equal([
        "msg-1",
        "msg-2"
      ]);

      localStorage.removeItem(`waku:sds:history:${testChannelId}`);
    });

    it("auto-uses localStorage when channelId is provided", () => {
      const testChannelId = `auto-storage-${Date.now()}`;

      const history = new LocalHistory({ storage: testChannelId });
      history.push(createMessage("msg-auto-1", 1));
      history.push(createMessage("msg-auto-2", 2));

      const history2 = new LocalHistory({ storage: testChannelId });
      expect(history2.length).to.equal(2);
      expect(history2.slice(0).map((m) => m.messageId)).to.deep.equal([
        "msg-auto-1",
        "msg-auto-2"
      ]);

      localStorage.removeItem(`waku:sds:history:${testChannelId}`);
    });
  });
});

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
