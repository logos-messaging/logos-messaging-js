import { multiaddr } from "@multiformats/multiaddr";
import { createLightNode, IMessage, Protocols } from "@waku/sdk";
import { expect } from "chai";

import { createRLNEncoder } from "./codec.js";
import { Keystore } from "./keystore/index.js";
import { Proof, proofToBytes } from "./proof.js";
import { RLNInstance } from "./rln.js";
// import { epochBytesToInt } from "./utils/epoch.js";
import { BytesUtils } from "./utils/index.js";
import {
  calculateRateCommitment,
  getPathDirectionsFromIndex,
  MERKLE_TREE_DEPTH,
  reconstructMerkleRoot
} from "./utils/merkle.js";
import { TEST_KEYSTORE_DATA } from "./utils/test_keystore.js";

describe.only("RLN Proof Integration Tests", function () {
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

    const proof = await rlnInstance.zerokit.generateRLNProof(
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

  const nwakuNode3 = multiaddr(
    "/ip4/192.168.0.216/tcp/8002/ws/p2p/16Uiu2HAm4YTSbqhsa6xHfuqvo11T1oX4JgD5fMuDujsd1qojkfPi"
  );

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

    const testMessage = new TextEncoder().encode("test");

    // Generate the proof
    const { proof, epoch, rlnIdentifier } =
      await rlnInstance.zerokit.generateRLNProof(
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

    // Parse proof bytes into Proof class
    const parsedProof = new Proof(proof, epoch, rlnIdentifier);

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
      proof,
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

  it.only("sends a message with a proof", async function () {
    const waku = await createLightNode({
      networkConfig: {
        clusterId: 0,
        numShardsInCluster: 1
      },
      defaultBootstrap: false,
      libp2p: {
        filterMultiaddrs: false
      }
    });

    // Create RLN instance
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

    // Prepare merkle proof data
    const idCommitment = credential.identity.IDCommitmentBigInt;
    const merkleProof = TEST_KEYSTORE_DATA.merkleProof.map((p) => BigInt(p));
    const merkleRoot = BigInt(TEST_KEYSTORE_DATA.merkleRoot);
    const membershipIndex = Number(TEST_KEYSTORE_DATA.membershipIndex);
    const rateLimit = Number(TEST_KEYSTORE_DATA.rateLimit);

    const rateCommitment = calculateRateCommitment(
      idCommitment,
      BigInt(rateLimit)
    );
    const proofElementIndexes = extractPathDirectionsFromProof(
      merkleProof,
      rateCommitment,
      merkleRoot
    );
    if (!proofElementIndexes) {
      throw new Error("Failed to extract proof element indexes");
    }

    // Convert merkle proof to bytes format
    const pathElements = merkleProof.map((proof) =>
      BytesUtils.fromBigInt(proof, 32, "little")
    );
    const identityPathIndex = proofElementIndexes.map((index) =>
      BytesUtils.writeUIntLE(new Uint8Array(1), index, 0, 1)
    );

    // Create base encoder
    const contentTopic = "/rln/1/test/proto";
    // const pubsubTopic = "/waku/2/rs/1/0";
    const baseEncoder = waku.createEncoder({
      contentTopic
    });

    // Create RLN encoder
    const rlnEncoder = createRLNEncoder({
      encoder: baseEncoder,
      rlnInstance,
      index: membershipIndex,
      credential: credential.identity,
      pathElements,
      identityPathIndex,
      rateLimit
    });

    await waku.dial(nwakuNode3, [Protocols.LightPush]);

    await waku.waitForPeers([Protocols.LightPush]);

    // Create message
    const messageTimestamp = new Date();
    const message = {
      payload: new TextEncoder().encode("Hello RLN!"),
      timestamp: messageTimestamp
    };

    // Send message with proof
    const result = await waku.lightPush.send(rlnEncoder, message);
    console.log("LightPush result:", result);

    if (result.failures) {
      console.log(result.failures.map((f) => f.error));
    }

    expect(result.successes.length).to.be.greaterThan(0);
  });

  it("send many messages, track which succeed or fail", async function () {
    this.timeout(50000);

    const waku = await createLightNode({
      networkConfig: {
        clusterId: 0,
        numShardsInCluster: 1
      },
      defaultBootstrap: false,
      libp2p: {
        filterMultiaddrs: false
      }
    });

    console.log("node created");
    // Create RLN instance
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

    // Prepare merkle proof data
    const idCommitment = credential.identity.IDCommitmentBigInt;
    const merkleProof = TEST_KEYSTORE_DATA.merkleProof.map((p) => BigInt(p));
    const merkleRoot = BigInt(TEST_KEYSTORE_DATA.merkleRoot);
    const membershipIndex = Number(TEST_KEYSTORE_DATA.membershipIndex);
    const rateLimit = Number(TEST_KEYSTORE_DATA.rateLimit);

    const rateCommitment = calculateRateCommitment(
      idCommitment,
      BigInt(rateLimit)
    );
    const proofElementIndexes = extractPathDirectionsFromProof(
      merkleProof,
      rateCommitment,
      merkleRoot
    );
    if (!proofElementIndexes) {
      throw new Error("Failed to extract proof element indexes");
    }

    // Convert merkle proof to bytes format
    const pathElements = merkleProof.map((proof) =>
      BytesUtils.fromBigInt(proof, 32, "little")
    );
    const identityPathIndex = proofElementIndexes.map((index) =>
      BytesUtils.writeUIntLE(new Uint8Array(1), index, 0, 1)
    );

    // Create base encoder
    const contentTopic = "/rln/1/test/proto";
    // const pubsubTopic = "/waku/2/rs/1/0";
    const baseEncoder = waku.createEncoder({
      contentTopic
    });

    // Create RLN encoder
    const rlnEncoder = createRLNEncoder({
      encoder: baseEncoder,
      rlnInstance,
      index: membershipIndex,
      credential: credential.identity,
      pathElements,
      identityPathIndex,
      rateLimit
    });

    // connect to node
    await waku.dial(nwakuNode3, [Protocols.LightPush]);
    console.log("node dialed");
    await waku.waitForPeers([Protocols.LightPush]);
    console.log("peers waited");

    const messagesToSend = 20;

    const results: {
      success: boolean;
      epoch: number;
    }[] = [];

    for (let i = 0; i < messagesToSend; i++) {
      // Create message
      const messageTimestamp = new Date();
      const message = {
        payload: new TextEncoder().encode("Hello RLN!"),
        timestamp: messageTimestamp
      };

      // Send message with proof
      console.log("sending message", i);
      const result = await waku.lightPush.send(rlnEncoder, message, {
        autoRetry: false
      });
      const success = result.successes.length > 0;
      console.log("success:", success);
      const timestampSeconds = Math.floor(message.timestamp!.getTime() / 1000);
      results.push({
        success,
        epoch: timestampSeconds
      });

      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  });
});
