import { expect } from "chai";

import { RLNInstance } from "./rln.js";

describe("@waku/rln", () => {
  it("should generate the same membership key if the same seed is provided", async function () {
    const rlnInstance = await RLNInstance.create();

    const seed = "This is a test seed";
    const memKeys1 = rlnInstance.zerokit.generateSeededIdentityCredential(seed);
    const memKeys2 = rlnInstance.zerokit.generateSeededIdentityCredential(seed);

    memKeys1.IDCommitment.forEach((element, index) => {
      expect(element).to.equal(memKeys2.IDCommitment[index]);
    });
    memKeys1.IDNullifier.forEach((element, index) => {
      expect(element).to.equal(memKeys2.IDNullifier[index]);
    });
    memKeys1.IDSecretHash.forEach((element, index) => {
      expect(element).to.equal(memKeys2.IDSecretHash[index]);
    });
    memKeys1.IDTrapdoor.forEach((element, index) => {
      expect(element).to.equal(memKeys2.IDTrapdoor[index]);
    });
  });
});
