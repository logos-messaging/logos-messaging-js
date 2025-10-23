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

  let currentValue = leafValue;

  // Process each level of the tree (0 to MERKLE_TREE_DEPTH-1)
  for (let level = 0; level < MERKLE_TREE_DEPTH; level++) {
    // Check if bit `level` is set in the leaf index
    const bit = (leafIndex >> BigInt(level)) & 1n;

    // Convert bigints to Uint8Array for hashing
    const currentBytes = bigIntToBytes32(currentValue);
    const proofBytes = bigIntToBytes32(proof[level]);

    let hashResult: Uint8Array;

    if (bit === 0n) {
      // Current node is a left child: hash(current, proof[level])
      hashResult = poseidonHash(currentBytes, proofBytes);
    } else {
      // Current node is a right child: hash(proof[level], current)
      hashResult = poseidonHash(proofBytes, currentBytes);
    }

    // Convert hash result back to bigint for next iteration
    currentValue = BytesUtils.toBigInt(hashResult, "little");
  }

  return currentValue;
}

/**
 * Extracts index information from a Merkle proof by attempting to reconstruct
 * the root with different possible indices and comparing against the expected root
 *
 * @param proof - Array of MERKLE_TREE_DEPTH bigint elements representing the Merkle proof
 * @param leafValue - The value of the leaf (typically the rate commitment)
 * @param expectedRoot - The expected root to match against
 * @param maxIndex - Maximum index to try (default: 2^MERKLE_TREE_DEPTH - 1)
 * @returns The index that produces the expected root, or null if not found
 */
function extractIndexFromProof(
  proof: readonly bigint[],
  leafValue: bigint,
  expectedRoot: bigint,
  maxIndex: bigint = (1n << BigInt(MERKLE_TREE_DEPTH)) - 1n
): bigint | null {
  // Try different indices to see which one produces the expected root
  for (let index = 0n; index <= maxIndex; index++) {
    try {
      const reconstructedRoot = reconstructMerkleRoot(proof, index, leafValue);
      if (reconstructedRoot === expectedRoot) {
        return index;
      }
    } catch (error) {
      // Continue trying other indices if reconstruction fails
      continue;
    }
  }

  return null;
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
  const idBytes = bigIntToBytes32(idCommitment);
  const rateLimitBytes = bigIntToBytes32(rateLimit);

  const hashResult = poseidonHash(idBytes, rateLimitBytes);
  return BytesUtils.toBigInt(hashResult, "little");
}

/**
 * Converts a bigint to a 32-byte Uint8Array in little-endian format
 *
 * @param value - The bigint value to convert
 * @returns 32-byte Uint8Array representation
 */
function bigIntToBytes32(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let temp = value;

  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }

  return bytes;
}

/**
 * Extracts the path direction bits from a Merkle proof by finding the leaf index
 * that produces the expected root, then converting that index to path directions
 *
 * @param proof - Array of MERKLE_TREE_DEPTH bigint elements representing the Merkle proof
 * @param leafValue - The value of the leaf (typically the rate commitment)
 * @param expectedRoot - The expected root to match against
 * @param maxIndex - Maximum index to try (default: 2^MERKLE_TREE_DEPTH - 1)
 * @returns Array of MERKLE_TREE_DEPTH numbers (0 or 1) representing path directions, or null if no valid path found
 *          - 0 means the node is a left child (hash order: current, sibling)
 *          - 1 means the node is a right child (hash order: sibling, current)
 */
export function extractPathDirectionsFromProof(
  proof: readonly bigint[],
  leafValue: bigint,
  expectedRoot: bigint,
  maxIndex: bigint = (1n << BigInt(MERKLE_TREE_DEPTH)) - 1n
): number[] | null {
  // First, find the leaf index that produces the expected root
  const leafIndex = extractIndexFromProof(
    proof,
    leafValue,
    expectedRoot,
    maxIndex
  );

  if (leafIndex === null) {
    return null;
  }

  // Convert the leaf index to path directions
  return getPathDirectionsFromIndex(leafIndex);
}

/**
 * Converts a leaf index to an array of path direction bits
 *
 * @param leafIndex - The index of the leaf in the tree
 * @returns Array of MERKLE_TREE_DEPTH numbers (0 or 1) representing path directions
 *          - 0 means the node is a left child (hash order: current, sibling)
 *          - 1 means the node is a right child (hash order: sibling, current)
 */
function getPathDirectionsFromIndex(leafIndex: bigint): number[] {
  const pathDirections: number[] = [];

  // For each level (0 to MERKLE_TREE_DEPTH-1), extract the bit that determines left/right
  for (let level = 0; level < MERKLE_TREE_DEPTH; level++) {
    // Check if bit `level` is set in the leaf index
    const bit = (leafIndex >> BigInt(level)) & 1n;
    pathDirections.push(Number(bit));
  }

  return pathDirections;
}
