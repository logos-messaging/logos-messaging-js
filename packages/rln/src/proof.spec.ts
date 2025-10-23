import { expect } from "chai";

import { Keystore } from "./keystore/index.js";
import { RLNInstance } from "./rln.js";
import { BytesUtils } from "./utils/index.js";
import {
  calculateRateCommitment,
  extractPathDirectionsFromProof,
  MERKLE_TREE_DEPTH,
  reconstructMerkleRoot
} from "./utils/merkle.js";
import { TEST_KEYSTORE_DATA } from "./utils/test_keystore.js";

describe("RLN Proof Integration Tests", function () {
  this.timeout(30000);

  it("validate stored merkle proof data", function () {
    // Convert stored merkle proof strings to bigints
    const merkleProof = TEST_KEYSTORE_DATA.merkleProof.map((p) => BigInt(p));

    expect(merkleProof).to.be.an("array");
    expect(merkleProof).to.have.lengthOf(MERKLE_TREE_DEPTH); // RLN uses fixed depth merkle tree

    merkleProof.forEach((element, i) => {
      expect(element).to.be.a(
        "bigint",
        `Proof element ${i} should be a bigint`
      );
      expect(element).to.not.equal(0n, `Proof element ${i} should not be zero`);
    });
  });

  it("should generate a valid RLN proof", async function () {
    const rlnInstance = await RLNInstance.create();
    // Load credential from test keystore
    const keystore = Keystore.fromString(TEST_KEYSTORE_DATA.keystoreJson);
    if (!keystore) {
      throw new Error("Failed to load test keystore");
    }
    const credentialHash = TEST_KEYSTORE_DATA.credentialHash;
    const password = TEST_KEYSTORE_DATA.password;
    const credential = await keystore.readCredential(credentialHash, password);
    if (!credential) {
      throw new Error("Failed to unlock credential with provided password");
    }

    const idCommitment = credential.identity.IDCommitmentBigInt;

    const merkleProof = TEST_KEYSTORE_DATA.merkleProof.map((p) => BigInt(p));
    const merkleRoot = BigInt(TEST_KEYSTORE_DATA.merkleRoot);
    const membershipIndex = BigInt(TEST_KEYSTORE_DATA.membershipIndex);
    const rateLimit = BigInt(TEST_KEYSTORE_DATA.rateLimit);

    const rateCommitment = calculateRateCommitment(idCommitment, rateLimit);

    const proofElementIndexes = extractPathDirectionsFromProof(
      merkleProof,
      rateCommitment,
      merkleRoot
    );
    if (!proofElementIndexes) {
      throw new Error("Failed to extract proof element indexes");
    }

    expect(proofElementIndexes).to.have.lengthOf(MERKLE_TREE_DEPTH);

    const reconstructedRoot = reconstructMerkleRoot(
      merkleProof,
      membershipIndex,
      rateCommitment
    );

    expect(reconstructedRoot).to.equal(
      merkleRoot,
      "Reconstructed root should match stored root"
    );

    const testMessage = new TextEncoder().encode("test");

    const proof = await rlnInstance.zerokit.generateRLNProof(
      testMessage,
      Number(membershipIndex),
      new Date(),
      credential.identity.IDSecretHash,
      merkleProof.map((proof) => BytesUtils.fromBigInt(proof, 32, "little")),
      proofElementIndexes.map((index) =>
        BytesUtils.writeUIntLE(new Uint8Array(1), index, 0, 1)
      ),
      Number(rateLimit),
      0
    );

    const isValid = rlnInstance.zerokit.verifyRLNProof(
      BytesUtils.writeUIntLE(new Uint8Array(8), testMessage.length, 0, 8),
      testMessage,
      proof,
      [BytesUtils.fromBigInt(merkleRoot, 32, "little")]
    );
    expect(isValid).to.be.true;
  });
});
