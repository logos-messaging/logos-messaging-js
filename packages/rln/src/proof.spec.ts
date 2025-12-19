import { expect } from "chai";

import { Keystore } from "./keystore/index.js";
import { Proof, proofToBytes } from "./proof.js";
import { RLNInstance } from "./rln.js";
import { BytesUtils } from "./utils/index.js";
import {
  calculateRateCommitment,
  getPathDirectionsFromIndex,
  MERKLE_TREE_DEPTH,
  reconstructMerkleRoot
} from "./utils/merkle.js";
import { TEST_KEYSTORE_DATA } from "./utils/test_keystore.js";

describe("RLN Proof Unit Tests", function () {
  this.timeout(30000);

  it("validate stored merkle proof data", function () {
    const merkleProof = TEST_KEYSTORE_DATA.merkleProof.map((p) => BigInt(p));

    expect(merkleProof).to.be.an("array");
    expect(merkleProof).to.have.lengthOf(MERKLE_TREE_DEPTH);

    for (let i = 0; i < merkleProof.length; i++) {
      const element = merkleProof[i];
      expect(element).to.be.a(
        "bigint",
        `Proof element ${i} should be a bigint`
      );
      expect(element).to.not.equal(0n, `Proof element ${i} should not be zero`);
    }
  });

  it("should generate a valid RLN proof", async function () {
    const rlnInstance = await RLNInstance.create();
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

    const proofElementIndexes = getPathDirectionsFromIndex(membershipIndex);

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

    const { proof } = await rlnInstance.zerokit.generateRLNProof(
      testMessage,
      new Date(),
      credential.identity.IDSecretHash,
      merkleProof.map((element) =>
        BytesUtils.bytes32FromBigInt(element, "little")
      ),
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
      [BytesUtils.bytes32FromBigInt(merkleRoot, "little")]
    );
    expect(isValid).to.be.true;
  });

  it("should parse proof bytes into Proof class", async function () {
    const rlnInstance = await RLNInstance.create();

    // Load credential from test keystore
    const keystore = Keystore.fromString(TEST_KEYSTORE_DATA.keystoreJson);
    if (!keystore) {
      throw new Error("Failed to load test keystore");
    }
    const credential = await keystore.readCredential(
      TEST_KEYSTORE_DATA.credentialHash,
      TEST_KEYSTORE_DATA.password
    );
    if (!credential) {
      throw new Error("Failed to unlock credential with provided password");
    }

    const merkleProof = TEST_KEYSTORE_DATA.merkleProof.map((p) => BigInt(p));
    const merkleRoot = BigInt(TEST_KEYSTORE_DATA.merkleRoot);
    const membershipIndex = BigInt(TEST_KEYSTORE_DATA.membershipIndex);
    const rateLimit = BigInt(TEST_KEYSTORE_DATA.rateLimit);

    const proofElementIndexes = getPathDirectionsFromIndex(membershipIndex);

    const testMessage = new TextEncoder().encode("test");

    // Generate the proof
    const { proof, epoch, rlnIdentifier } =
      await rlnInstance.zerokit.generateRLNProof(
        testMessage,
        new Date(),
        credential.identity.IDSecretHash,
        merkleProof.map((proof) => BytesUtils.bytes32FromBigInt(proof)),
        proofElementIndexes.map((index) =>
          BytesUtils.writeUIntLE(new Uint8Array(1), index, 0, 1)
        ),
        Number(rateLimit),
        0
      );

    // Parse proof bytes into Proof class
    const parsedProof = new Proof(proof.toBytesLE(), epoch, rlnIdentifier);

    // Verify all fields have correct lengths according to Nim format:
    // proof<128> | root<32> | external_nullifier<32> | share_x<32> | share_y<32> | nullifier<32>
    expect(parsedProof.proof).to.have.lengthOf(128);
    expect(parsedProof.merkleRoot).to.have.lengthOf(32);
    expect(parsedProof.externalNullifier).to.have.lengthOf(32);
    expect(parsedProof.shareX).to.have.lengthOf(32);
    expect(parsedProof.shareY).to.have.lengthOf(32);
    expect(parsedProof.nullifier).to.have.lengthOf(32);

    // Verify merkle root matches expected
    const parsedMerkleRoot = BytesUtils.toBigInt(parsedProof.merkleRoot);
    expect(parsedMerkleRoot).to.equal(
      merkleRoot,
      "Parsed merkle root should match expected"
    );

    // Verify round-trip: proofToBytes should reconstruct original bytes
    const reconstructedBytes = proofToBytes(parsedProof);
    expect(reconstructedBytes).to.deep.equal(
      proof.toBytesLE(),
      "Reconstructed bytes should match original"
    );

    // Verify extractMetadata works
    const metadata = parsedProof.extractMetadata();
    expect(metadata.nullifier).to.deep.equal(parsedProof.nullifier);
    expect(metadata.shareX).to.deep.equal(parsedProof.shareX);
    expect(metadata.shareY).to.deep.equal(parsedProof.shareY);
    expect(metadata.externalNullifier).to.deep.equal(
      parsedProof.externalNullifier
    );
  });
});
