import { type Address, createWalletClient, http, publicActions } from "viem";
import { lineaSepolia } from "viem/chains";

import { RLN_CONTRACT } from "../contract/constants.js";
import { RLNBaseContract } from "../contract/rln_base_contract.js";
import { TEST_KEYSTORE_DATA } from "../utils/test_keystore.js";

async function updateMerkleProof(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("Connecting to Linea Sepolia RPC...");

  // Create RPC client (read-only, no account needed)
  const rpcClient = createWalletClient({
    chain: lineaSepolia,
    transport: http("https://rpc.sepolia.linea.build")
  }).extend(publicActions);

  // eslint-disable-next-line no-console
  console.log("Initializing RLN contract...");
  const contract = await RLNBaseContract.create({
    address: RLN_CONTRACT.address as Address,
    rpcClient
  });

  const membershipIndex = Number(TEST_KEYSTORE_DATA.membershipIndex);
  // eslint-disable-next-line no-console
  console.log(`Fetching merkle proof for index ${membershipIndex}...`);

  // Get current merkle root
  const merkleRoot = await contract.getMerkleRoot();
  // eslint-disable-next-line no-console
  console.log(`Current merkle root: ${merkleRoot}`);

  // Get merkle proof for the membership index
  const merkleProof = await contract.getMerkleProof(membershipIndex);
  // eslint-disable-next-line no-console
  console.log(`Merkle proof (${merkleProof.length} elements):`);
  merkleProof.forEach((element, i) => {
    // eslint-disable-next-line no-console
    console.log(`  [${i}]: ${element}`);
  });

  // Format the output for updating test_keystore.ts
  // eslint-disable-next-line no-console
  console.log("\n=== Update test_keystore.ts with these values ===\n");
  // eslint-disable-next-line no-console
  console.log("merkleProof: [");
  merkleProof.forEach((element, i) => {
    const comma = i < merkleProof.length - 1 ? "," : "";
    // eslint-disable-next-line no-console
    console.log(`  "${element}"${comma}`);
  });
  // eslint-disable-next-line no-console
  console.log("],");
  // eslint-disable-next-line no-console
  console.log(`merkleRoot: "${merkleRoot}",`);
}

updateMerkleProof()
  .then(() => {
    // eslint-disable-next-line no-console
    console.log("\nScript completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Error updating merkle proof:", error);
    process.exit(1);
  });
