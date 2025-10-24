import { RLN_CONTRACT } from "./contract/index.js";
import { RLNBaseContract } from "./contract/rln_base_contract.js";
import { createRLN } from "./create.js";
import { IdentityCredential } from "./identity.js";
import { Keystore } from "./keystore/index.js";
import { RLNInstance } from "./rln.js";
<<<<<<< HEAD
import { createViemClientFromWindow } from "./utils/index.js";
=======
import { createViemClientsFromWindow } from "./utils/index.js";
>>>>>>> a88dd8cdbd (feat: migrate rln from ethers to viem)

export {
  RLNBaseContract,
  createRLN,
  Keystore,
  RLNInstance,
  IdentityCredential,
  RLN_CONTRACT,
<<<<<<< HEAD
  createViemClientFromWindow
=======
  createViemClientsFromWindow as extractMetaMaskSigner
>>>>>>> a88dd8cdbd (feat: migrate rln from ethers to viem)
};

export {
  wakuRlnV2Abi,
  linearPriceCalculatorAbi,
  iPriceCalculatorAbi,
  membershipUpgradeableAbi
} from "./contract/wagmi/generated.js";

export type {
  DecryptedCredentials,
  EncryptedCredentials,
  Keccak256Hash,
  KeystoreEntity,
  MembershipHash,
  KeystoreMembershipInfo,
  Password,
  Sha256Hash
} from "./keystore/types.js";

export * from "./contract/index.js";
