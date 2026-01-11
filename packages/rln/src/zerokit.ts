import {
  ExtendedIdentity,
  Hasher,
  VecWasmFr,
  WasmFr,
  WasmRLN,
  WasmRLNProof,
  WasmRLNWitnessInput
} from "@waku/zerokit-rln-wasm";

import { DEFAULT_RATE_LIMIT, RATE_LIMIT_PARAMS } from "./contract/constants.js";
import { WitnessCalculator } from "./resources/witness_calculator";
import { dateToEpochBytes } from "./utils/epoch.js";
import { MERKLE_TREE_DEPTH } from "./utils/merkle.js";

export class Zerokit {
  public constructor(
    private readonly zkRLN: WasmRLN,
    private readonly witnessCalculator: WitnessCalculator,
    public readonly rateLimit: number = DEFAULT_RATE_LIMIT,
    public readonly rlnIdentifier: Uint8Array = (() => {
      const encoded = new TextEncoder().encode("rln/waku-rln-relay/v2.0.0");
      const padded = new Uint8Array(32);
      padded.set(encoded);
      return padded;
    })()
  ) {}

  public get getWitnessCalculator(): WitnessCalculator {
    return this.witnessCalculator;
  }

  public generateSeededIdentityCredential(seed: string): ExtendedIdentity {
    const stringEncoder = new TextEncoder();
    const seedBytes = stringEncoder.encode(seed);
    return ExtendedIdentity.generateSeeded(seedBytes);
  }

  public async generateRLNProof(
    msg: Uint8Array,
    timestamp: Date,
    idSecretHash: Uint8Array,
    pathElements: Uint8Array[],
    identityPathIndex: Uint8Array[],
    rateLimit: number,
    messageId: number // number of message sent by the user in this epoch
  ): Promise<{
    proof: WasmRLNProof;
    epoch: Uint8Array;
    rlnIdentifier: Uint8Array;
  }> {
    const epoch = dateToEpochBytes(timestamp);

    if (epoch.length !== 32)
      throw new Error(`Epoch must be 32 bytes, got ${epoch.length}`);
    if (idSecretHash.length !== 32)
      throw new Error(
        `ID secret hash must be 32 bytes, got ${idSecretHash.length}`
      );
    if (pathElements.length !== MERKLE_TREE_DEPTH)
      throw new Error(`Path elements must be ${MERKLE_TREE_DEPTH} bytes`);
    if (identityPathIndex.length !== MERKLE_TREE_DEPTH)
      throw new Error(`Identity path index must be ${MERKLE_TREE_DEPTH} bytes`);
    if (
      rateLimit < RATE_LIMIT_PARAMS.MIN_RATE ||
      rateLimit > RATE_LIMIT_PARAMS.MAX_RATE
    ) {
      throw new Error(
        `Rate limit must be between ${RATE_LIMIT_PARAMS.MIN_RATE} and ${RATE_LIMIT_PARAMS.MAX_RATE}`
      );
    }

    if (messageId < 0 || messageId >= rateLimit) {
      throw new Error(
        `messageId must be an integer between 0 and ${rateLimit - 1}, got ${messageId}`
      );
    }
    const pathElementsVec = new VecWasmFr();
    for (const element of pathElements) {
      pathElementsVec.push(WasmFr.fromBytesLE(element));
    }
    const identityPathIndexBytes = new Uint8Array(identityPathIndex.length);
    for (let i = 0; i < identityPathIndex.length; i++) {
      // We assume that each identity path index is already in little-endian format
      identityPathIndexBytes.set(identityPathIndex[i], i);
    }
    const x = Hasher.hashToFieldLE(msg);
    const externalNullifier = Hasher.poseidonHashPair(
      Hasher.hashToFieldLE(epoch),
      Hasher.hashToFieldLE(this.rlnIdentifier)
    );
    const witness = new WasmRLNWitnessInput(
      WasmFr.fromBytesLE(idSecretHash),
      WasmFr.fromUint(rateLimit),
      WasmFr.fromUint(messageId),
      pathElementsVec,
      identityPathIndexBytes,
      x,
      externalNullifier
    );

    const calculatedWitness: bigint[] =
      await this.witnessCalculator.calculateWitness(
        witness.toBigIntJson() as Record<string, unknown>
      );
    const proof = this.zkRLN.generateRLNProofWithWitness(
      calculatedWitness,
      witness
    );
    return {
      proof,
      epoch,
      rlnIdentifier: this.rlnIdentifier
    };
  }

  public verifyRLNProof(
    signalLength: Uint8Array,
    signal: Uint8Array,
    proof: WasmRLNProof,
    roots: Uint8Array[]
  ): boolean {
    if (signalLength.length !== 8)
      throw new Error("signalLength must be 8 bytes");
    if (roots.length == 0) throw new Error("roots array is empty");
    if (roots.find((root) => root.length !== 32)) {
      throw new Error("All roots must be 32 bytes");
    }

    const rootsVec = new VecWasmFr();
    for (const root of roots) {
      rootsVec.push(WasmFr.fromBytesLE(root));
    }
    const x = Hasher.hashToFieldLE(signal);
    return this.zkRLN.verifyWithRoots(proof, rootsVec, x);
  }
}
