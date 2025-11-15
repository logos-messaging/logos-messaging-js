import { expect } from "chai";

import { MemLocalHistory } from "./mem_local_history.js";
import { ContentMessage } from "./message.js";

describe("MemLocalHistory", () => {
  it("Cap max size when messages are pushed one at a time", () => {
    const maxSize = 2;

    const hist = new MemLocalHistory(maxSize);

    hist.push(
      new ContentMessage("1", "c", "a", [], 1n, undefined, new Uint8Array([1]))
    );
    expect(hist.length).to.eq(1);
    hist.push(
      new ContentMessage("2", "c", "a", [], 2n, undefined, new Uint8Array([2]))
    );
    expect(hist.length).to.eq(2);

    hist.push(
      new ContentMessage("3", "c", "a", [], 3n, undefined, new Uint8Array([3]))
    );
    expect(hist.length).to.eq(2);

    expect(hist.findIndex((m) => m.messageId === "1")).to.eq(-1);
    expect(hist.findIndex((m) => m.messageId === "2")).to.not.eq(-1);
    expect(hist.findIndex((m) => m.messageId === "3")).to.not.eq(-1);
  });

  it("Cap max size when a pushed array is exceeding the cap", () => {
    const maxSize = 2;

    const hist = new MemLocalHistory(maxSize);

    hist.push(
      new ContentMessage("1", "c", "a", [], 1n, undefined, new Uint8Array([1]))
    );
    expect(hist.length).to.eq(1);
    hist.push(
      new ContentMessage("2", "c", "a", [], 2n, undefined, new Uint8Array([2])),
      new ContentMessage("3", "c", "a", [], 3n, undefined, new Uint8Array([3]))
    );
    expect(hist.length).to.eq(2);

    expect(hist.findIndex((m) => m.messageId === "1")).to.eq(-1);
    expect(hist.findIndex((m) => m.messageId === "2")).to.not.eq(-1);
    expect(hist.findIndex((m) => m.messageId === "3")).to.not.eq(-1);
  });
});
