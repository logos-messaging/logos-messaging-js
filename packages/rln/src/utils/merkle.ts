import { BytesUtils } from "./bytes.js";
import { poseidonHash } from "./hash.js";

/**
 * The fixed depth of the Merkle tree used in the RLN contract
 * This is a constant that will never change for the on-chain implementation
 */
export const MERKLE_TREE_DEPTH = 20;

/**
 * Reconstructs a Merkle tree root from a proof and leaf information
 *
 * @param proof - Array of MERKLE_TREE_DEPTH bigint elements representing the Merkle proof
 * @param leafIndex - The index of the leaf in the tree (used to determine left/right positioning)
 * @param leafValue - The value of the leaf (typically the rate commitment)
 * @returns The reconstructed root as a bigint
 */
export function reconstructMerkleRoot(
  proof: readonly bigint[],
  leafIndex: bigint,
  leafValue: bigint
): bigint {
  if (proof.length !== MERKLE_TREE_DEPTH) {
    throw new Error(
      `Expected proof of length ${MERKLE_TREE_DEPTH}, got ${proof.length}`
    );
  }

  let currentValue = BytesUtils.bytes32FromBigInt(leafValue);

  for (let level = 0; level < MERKLE_TREE_DEPTH; level++) {
    const bit = (leafIndex >> BigInt(level)) & 1n;

    const proofBytes = BytesUtils.bytes32FromBigInt(proof[level]);

    if (bit === 0n) {
      // Current node is a left child: hash(current, proof[level])
      currentValue = poseidonHash(currentValue, proofBytes);
    } else {
      // Current node is a right child: hash(proof[level], current)
      currentValue = poseidonHash(proofBytes, currentValue);
    }
  }

  return BytesUtils.toBigInt(currentValue, "little");
}

/**
 * Calculates the rate commitment from an ID commitment and rate limit
 * This matches the contract's calculation: PoseidonT3.hash([idCommitment, rateLimit])
 *
 * @param idCommitment - The identity commitment as a bigint
 * @param rateLimit - The rate limit as a bigint
 * @returns The rate commitment as a bigint
 */
export function calculateRateCommitment(
  idCommitment: bigint,
  rateLimit: bigint
): bigint {
  const idBytes = BytesUtils.bytes32FromBigInt(idCommitment);
  const rateLimitBytes = BytesUtils.bytes32FromBigInt(rateLimit);

  const hashResult = poseidonHash(idBytes, rateLimitBytes);
  return BytesUtils.toBigInt(hashResult, "little");
}

/**
 * Converts a leaf index to an array of path direction bits
 *
 * @param leafIndex - The index of the leaf in the tree
 * @returns Array of MERKLE_TREE_DEPTH numbers (0 or 1) representing path directions
 *          - 0 means the node is a left child (hash order: current, sibling)
 *          - 1 means the node is a right child (hash order: sibling, current)
 */
export function getPathDirectionsFromIndex(leafIndex: bigint): number[] {
  const pathDirections: number[] = [];

  // For each level (0 to MERKLE_TREE_DEPTH-1), extract the bit that determines left/right
  for (let level = 0; level < MERKLE_TREE_DEPTH; level++) {
    // Check if bit `level` is set in the leaf index
    const bit = (leafIndex >> BigInt(level)) & 1n;
    pathDirections.push(Number(bit));
  }

  return pathDirections;
}
