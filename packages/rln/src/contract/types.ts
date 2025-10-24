<<<<<<< HEAD
import { Address } from "viem";

import { RpcClient } from "../utils/index.js";
=======
import { Address, PublicClient, WalletClient } from "viem";
>>>>>>> a88dd8cdbd (feat: migrate rln from ethers to viem)

export type Member = {
  idCommitment: string;
  index: bigint;
};

export interface RLNContractOptions {
<<<<<<< HEAD
  rpcClient: RpcClient;
=======
  publicClient: PublicClient;
  walletClient: WalletClient;
>>>>>>> a88dd8cdbd (feat: migrate rln from ethers to viem)
  address: Address;
  rateLimit?: number;
}

export interface MembershipRegisteredEvent {
  idCommitment: string;
  membershipRateLimit: bigint;
  index: bigint;
}

export type FetchMembersOptions = {
  fromBlock?: number;
  fetchRange?: number;
  fetchChunks?: number;
};

export interface MembershipInfo {
  index: number;
  idCommitment: string;
  rateLimit: number;
  startBlock: number;
  endBlock: number;
  state: MembershipState;
  depositAmount: bigint;
  activeDuration: number;
  gracePeriodDuration: number;
  holder: string;
  token: string;
}

export enum MembershipState {
  Active = "Active",
  GracePeriod = "GracePeriod",
  Expired = "Expired",
  ErasedAwaitsWithdrawal = "ErasedAwaitsWithdrawal"
}
