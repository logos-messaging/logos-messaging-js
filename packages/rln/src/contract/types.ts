import { Address, PublicClient, WalletClient } from "viem";

export type Member = {
  idCommitment: string;
  index: bigint;
};

export interface RLNContractOptions {
  publicClient: PublicClient;
  walletClient: WalletClient;
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
