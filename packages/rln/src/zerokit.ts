import * as zerokitRLN from "@waku/zerokit-rln-wasm";
import { generateSeededExtendedMembershipKey } from "@waku/zerokit-rln-wasm-utils";

import { DEFAULT_RATE_LIMIT, RATE_LIMIT_PARAMS } from "./contract/constants.js";
import { IdentityCredential } from "./identity.js";
import { WitnessCalculator } from "./resources/witness_calculator";
import { BytesUtils } from "./utils/bytes.js";
import { dateToEpoch, epochIntToBytes } from "./utils/epoch.js";
import { poseidonHash, sha256 } from "./utils/hash.js";

export class Zerokit {
  public constructor(
    private readonly zkRLN: number,
    private readonly witnessCalculator: WitnessCalculator,
    private readonly _rateLimit: number = DEFAULT_RATE_LIMIT,
    private readonly rlnIdentifier: Uint8Array = new TextEncoder().encode(
      "rln/waku-rln-relay/v2.0.0"
    )
  ) {}

  public get getZkRLN(): number {
    return this.zkRLN;
  }

  public get getWitnessCalculator(): WitnessCalculator {
    return this.witnessCalculator;
  }

  public get rateLimit(): number {
    return this._rateLimit;
  }

  public generateSeededIdentityCredential(seed: string): IdentityCredential {
    const stringEncoder = new TextEncoder();
    const seedBytes = stringEncoder.encode(seed);
    const memKeys = generateSeededExtendedMembershipKey(seedBytes, true);
    return IdentityCredential.fromBytes(memKeys);
  }

  public async serializeWitness(
    idSecretHash: Uint8Array,
    pathElements: Uint8Array[],
    identityPathIndex: Uint8Array[],
    x: Uint8Array,
    epoch: Uint8Array,
    rateLimit: number,
    messageId: number // number of message sent by the user in this epoch
  ): Promise<Uint8Array> {
    const externalNullifier = poseidonHash(
      sha256(epoch),
      sha256(this.rlnIdentifier)
    );
    const pathElementsBytes = new Uint8Array(8 + pathElements.length * 32);
    BytesUtils.writeUIntLE(pathElementsBytes, pathElements.length, 0, 8);
    for (let i = 0; i < pathElements.length; i++) {
      // We assume that the path elements are already in little-endian format
      pathElementsBytes.set(pathElements[i], 8 + i * 32);
    }
    const identityPathIndexBytes = new Uint8Array(
      8 + identityPathIndex.length * 1
    );
    BytesUtils.writeUIntLE(
      identityPathIndexBytes,
      identityPathIndex.length,
      0,
      8
    );
    for (let i = 0; i < identityPathIndex.length; i++) {
      // We assume that each identity path index is already in little-endian format
      identityPathIndexBytes.set(identityPathIndex[i], 8 + i * 1);
    }
    return BytesUtils.concatenate(
      idSecretHash,
      BytesUtils.writeUIntLE(new Uint8Array(32), rateLimit, 0, 32),
      BytesUtils.writeUIntLE(new Uint8Array(32), messageId, 0, 32),
      pathElementsBytes,
      identityPathIndexBytes,
      x,
      externalNullifier
    );
  }

  public async generateRLNProof(
    msg: Uint8Array,
    index: number, // index of the leaf in the merkle tree
    epoch: Uint8Array | Date | undefined,
    idSecretHash: Uint8Array,
    pathElements: Uint8Array[],
    identityPathIndex: Uint8Array[],
    rateLimit: number,
    messageId: number // number of message sent by the user in this epoch
  ): Promise<Uint8Array> {
    if (epoch === undefined) {
      epoch = epochIntToBytes(dateToEpoch(new Date()));
    } else if (epoch instanceof Date) {
      epoch = epochIntToBytes(dateToEpoch(epoch));
    }

    if (epoch.length !== 32) throw new Error("invalid epoch");
    if (idSecretHash.length !== 32) throw new Error("invalid id secret hash");
    if (index < 0) throw new Error("index must be >= 0");
    if (
      rateLimit < RATE_LIMIT_PARAMS.MIN_RATE ||
      rateLimit > RATE_LIMIT_PARAMS.MAX_RATE
    ) {
      throw new Error(
        `Rate limit must be between ${RATE_LIMIT_PARAMS.MIN_RATE} and ${RATE_LIMIT_PARAMS.MAX_RATE}`
      );
    }

    const x = sha256(msg);

    const serializedWitness = await this.serializeWitness(
      idSecretHash,
      pathElements,
      identityPathIndex,
      x,
      epoch,
      rateLimit,
      messageId
    );
    const witnessJson: Record<string, unknown> = zerokitRLN.rlnWitnessToJson(
      this.zkRLN,
      serializedWitness
    ) as Record<string, unknown>;
    const calculatedWitness: bigint[] =
      await this.witnessCalculator.calculateWitness(witnessJson);
    return zerokitRLN.generateRLNProofWithWitness(
      this.zkRLN,
      calculatedWitness,
      serializedWitness
    );
  }

  public verifyRLNProof(
    signalLength: Uint8Array,
    signal: Uint8Array,
    proof: Uint8Array,
    roots: Uint8Array[]
  ): boolean {
    if (signalLength.length !== 8)
      throw new Error("signalLength must be 8 bytes");
    return zerokitRLN.verifyWithRoots(
      this.zkRLN,
      BytesUtils.concatenate(proof, signalLength, signal),
      BytesUtils.concatenate(...roots)
    );
  }
}
