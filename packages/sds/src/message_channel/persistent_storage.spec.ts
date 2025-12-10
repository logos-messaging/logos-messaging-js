import { expect } from "chai";

import { LocalHistory } from "./local_history.js";
import { ContentMessage } from "./message.js";

const channelId = "channel-1";

describe("Storage", () => {
  describe("Browser localStorage", () => {
    before(function () {
      if (typeof localStorage === "undefined") {
        this.skip();
      }
    });

    afterEach(() => {
      localStorage.removeItem(`waku:sds:storage:${channelId}`);
    });

    it("persists and restores messages", () => {
      const history1 = new LocalHistory({ storagePrefix: channelId });
      history1.push(createMessage("msg-1", 1));
      history1.push(createMessage("msg-2", 2));

      const history2 = new LocalHistory({ storagePrefix: channelId });

      expect(history2.length).to.equal(2);
      expect(history2.slice(0).map((msg) => msg.messageId)).to.deep.equal([
        "msg-1",
        "msg-2"
      ]);
    });

    it("handles corrupt data gracefully", () => {
      localStorage.setItem(`waku:sds:storage:${channelId}`, "{ invalid json }");

      const history = new LocalHistory({ storagePrefix: channelId });
      expect(history.length).to.equal(0);
      // Corrupt data is removed
      expect(localStorage.getItem(`waku:sds:storage:${channelId}`)).to.be.null;
    });

    it("isolates history by channel ID", () => {
      const history1 = new LocalHistory({ storagePrefix: "channel-1" });
      const history2 = new LocalHistory({ storagePrefix: "channel-2" });

      history1.push(createMessage("msg-1", 1));
      history2.push(createMessage("msg-2", 2));

      expect(history1.length).to.equal(1);
      expect(history1.slice(0)[0].messageId).to.equal("msg-1");

      expect(history2.length).to.equal(1);
      expect(history2.slice(0)[0].messageId).to.equal("msg-2");

      localStorage.removeItem("waku:sds:storage:channel-2");
    });

    it("saves messages after each push", () => {
      const history = new LocalHistory({ storagePrefix: channelId });

      expect(localStorage.getItem(`waku:sds:storage:${channelId}`)).to.be.null;

      history.push(createMessage("msg-1", 1));

      expect(localStorage.getItem(`waku:sds:storage:${channelId}`)).to.not.be
        .null;

      const saved = JSON.parse(
        localStorage.getItem(`waku:sds:storage:${channelId}`)!
      );
      expect(saved).to.have.lengthOf(1);
      expect(saved[0].messageId).to.equal("msg-1");
    });

    it("loads messages on initialization", () => {
      const history1 = new LocalHistory({ storagePrefix: channelId });

      history1.push(createMessage("msg-1", 1));
      history1.push(createMessage("msg-2", 2));
      history1.push(createMessage("msg-3", 3));

      const history2 = new LocalHistory({ storagePrefix: channelId });

      expect(history2.length).to.equal(3);
      expect(history2.slice(0).map((m) => m.messageId)).to.deep.equal([
        "msg-1",
        "msg-2",
        "msg-3"
      ]);
    });
  });

  describe("In-memory fallback", () => {
    it("uses in-memory only when no storage is provided", () => {
      const history = new LocalHistory({ maxSize: 100 });
      history.push(createMessage("msg-3", 3));

      expect(history.length).to.equal(1);
      expect(history.slice(0)[0].messageId).to.equal("msg-3");

      const history2 = new LocalHistory({ maxSize: 100 });
      expect(history2.length).to.equal(0);
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
