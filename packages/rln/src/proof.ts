import type { IRateLimitProof } from "@waku/interfaces";

import { BytesUtils } from "./utils/index.js";

// Offsets for parsing proof bytes
// Format: proof<128> | root<32> | external_nullifier<32> | share_x<32> | share_y<32> | nullifier<32>
const proofOffset = 128;
const rootOffset = proofOffset + 32;
const externalNullifierOffset = rootOffset + 32;
const shareXOffset = externalNullifierOffset + 32;
const shareYOffset = shareXOffset + 32;
const nullifierOffset = shareYOffset + 32;

class ProofMetadata {
  public constructor(
    public readonly nullifier: Uint8Array,
    public readonly shareX: Uint8Array,
    public readonly shareY: Uint8Array,
    public readonly externalNullifier: Uint8Array
  ) {}
}

export class Proof implements IRateLimitProof {
  public readonly proof: Uint8Array;
  public readonly merkleRoot: Uint8Array;
  public readonly externalNullifier: Uint8Array;
  public readonly shareX: Uint8Array;
  public readonly shareY: Uint8Array;
  public readonly nullifier: Uint8Array;
  public readonly epoch: Uint8Array;
  public readonly rlnIdentifier: Uint8Array;

  public constructor(
    proofBytes: Uint8Array,
    epoch: Uint8Array,
    rlnIdentifier: Uint8Array
  ) {
    if (proofBytes.length < nullifierOffset) {
      throw new Error("invalid proof");
    }
    // parse the proof as proof<128> | root<32> | external_nullifier<32> | share_x<32> | share_y<32> | nullifier<32>
    this.proof = proofBytes.subarray(0, proofOffset);
    this.merkleRoot = proofBytes.subarray(proofOffset, rootOffset);
    this.externalNullifier = proofBytes.subarray(
      rootOffset,
      externalNullifierOffset
    );
    this.shareX = proofBytes.subarray(externalNullifierOffset, shareXOffset);
    this.shareY = proofBytes.subarray(shareXOffset, shareYOffset);
    this.nullifier = proofBytes.subarray(shareYOffset, nullifierOffset);

    if (epoch.length !== 32) {
      throw new Error("invalid epoch");
    }
    if (rlnIdentifier.length !== 32) {
      throw new Error("invalid rlnIdentifier");
    }
    this.epoch = epoch;
    this.rlnIdentifier = rlnIdentifier;
  }

  public extractMetadata(): ProofMetadata {
    return new ProofMetadata(
      this.nullifier,
      this.shareX,
      this.shareY,
      this.externalNullifier
    );
  }
}

export function proofToBytes(p: Proof): Uint8Array {
  return BytesUtils.concatenate(
    p.proof,
    p.merkleRoot,
    p.externalNullifier,
    p.shareX,
    p.shareY,
    p.nullifier
  );
}
