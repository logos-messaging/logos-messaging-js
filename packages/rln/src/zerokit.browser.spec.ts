import { expect } from "chai";

import { RLNInstance } from "./rln.js";

describe("@waku/rln", () => {
  it("should generate the same membership key if the same seed is provided", async function () {
    const rlnInstance = await RLNInstance.create();

    const seed = "This is a test seed";
    const memKeys1 = rlnInstance.zerokit.generateSeededIdentityCredential(seed);
    const memKeys2 = rlnInstance.zerokit.generateSeededIdentityCredential(seed);

    memKeys1
      .getCommitment()
      .toBytesLE()
      .forEach((element, index) => {
        expect(element).to.equal(memKeys2.getCommitment().toBytesLE()[index]);
      });
    memKeys1
      .getNullifier()
      .toBytesLE()
      .forEach((element, index) => {
        expect(element).to.equal(memKeys2.getNullifier().toBytesLE()[index]);
      });
    memKeys1
      .getSecretHash()
      .toBytesLE()
      .forEach((element, index) => {
        expect(element).to.equal(memKeys2.getSecretHash().toBytesLE()[index]);
      });
    memKeys1
      .getTrapdoor()
      .toBytesLE()
      .forEach((element, index) => {
        expect(element).to.equal(memKeys2.getTrapdoor().toBytesLE()[index]);
      });
  });
});
