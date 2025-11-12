import { Logger } from "@waku/utils";
import {
  type Address,
  decodeEventLog,
  getContract,
  GetContractReturnType,
  type Hash,
  publicActions,
  PublicClient,
  WalletClient
} from "viem";

import { IdentityCredential } from "../identity.js";
import { DecryptedCredentials } from "../keystore/types.js";

import {
  DEFAULT_RATE_LIMIT,
  RATE_LIMIT_PARAMS,
  RLN_CONTRACT
} from "./constants.js";
import {
  MembershipInfo,
  MembershipState,
  RLNContractOptions
} from "./types.js";
import { iPriceCalculatorAbi, wakuRlnV2Abi } from "./wagmi/generated.js";

const log = new Logger("rln:contract:base");

export class RLNBaseContract {
  public contract: GetContractReturnType<
    typeof wakuRlnV2Abi,
    PublicClient | WalletClient
  >;
  public rpcClient: WalletClient & PublicClient;
  private rateLimit: number;
  private minRateLimit?: number;
  private maxRateLimit?: number;

  /**
   * Private constructor for RLNBaseContract. Use static create() instead.
   */
  protected constructor(options: RLNContractOptions) {
    const { address, rpcClient, rateLimit = DEFAULT_RATE_LIMIT } = options;

    log.info("Initializing RLNBaseContract", { address, rateLimit });

    this.rpcClient = rpcClient.extend(publicActions) as WalletClient &
      PublicClient;
    this.contract = getContract({
      address,
      abi: wakuRlnV2Abi,
      client: this.rpcClient
    });
    this.rateLimit = rateLimit;
  }

  /**
   * Static async factory to create and initialize RLNBaseContract
   */
  public static async create(
    options: RLNContractOptions
  ): Promise<RLNBaseContract> {
    const instance = new RLNBaseContract(options);

    const [min, max] = await Promise.all([
      instance.contract.read.minMembershipRateLimit(),
      instance.contract.read.maxMembershipRateLimit()
    ]);

    instance.minRateLimit = min;
    instance.maxRateLimit = max;

    instance.validateRateLimit(instance.rateLimit);
    return instance;
  }

  /**
   * Gets the current rate limit for this contract instance
   */
  public getRateLimit(): number {
    return this.rateLimit;
  }

  /**
   * Gets the contract address
   */
  public get address(): string {
    return this.contract.address;
  }

  /**
   * Gets the minimum allowed rate limit (cached)
   */
  public getMinRateLimit(): number {
    if (this.minRateLimit === undefined)
      throw new Error("minRateLimit not initialized");
    return this.minRateLimit;
  }

  /**
   * Gets the maximum allowed rate limit (cached)
   */
  public getMaxRateLimit(): number {
    if (this.maxRateLimit === undefined)
      throw new Error("maxRateLimit not initialized");
    return this.maxRateLimit;
  }

  /**
   * Gets the maximum total rate limit across all memberships
   * @returns Promise<number> The maximum total rate limit in messages per epoch
   */
  public async getMaxTotalRateLimit(): Promise<number> {
    return await this.contract.read.maxTotalRateLimit();
  }

  /**
   * Gets the current total rate limit usage across all memberships
   * @returns Promise<number> The current total rate limit usage in messages per epoch
   */
  public async getCurrentTotalRateLimit(): Promise<number> {
    return Number(await this.contract.read.currentTotalRateLimit());
  }

  /**
   * Gets the remaining available total rate limit that can be allocated
   * @returns Promise<number> The remaining rate limit that can be allocated
   */
  public async getRemainingTotalRateLimit(): Promise<number> {
    return (
      (await this.contract.read.maxTotalRateLimit()) -
      Number(await this.contract.read.currentTotalRateLimit())
    );
  }

  /**
   * Updates the rate limit for future registrations
   * @param newRateLimit The new rate limit to use
   */
  public setRateLimit(newRateLimit: number): void {
    this.validateRateLimit(newRateLimit);
    this.rateLimit = newRateLimit;
  }

  /**
   * Gets the Merkle tree root for RLN proof verification
   * @returns Promise<bigint> The Merkle tree root
   *
   */
  public async getMerkleRoot(): Promise<bigint> {
    return this.contract.read.root();
  }

  /**
   * Gets the Merkle proof for a member at a given index
   * @param index The index of the member in the membership set
   * @returns Promise<bigint[]> Array of 20 Merkle proof elements
   *
   */
  public async getMerkleProof(index: number): Promise<readonly bigint[]> {
    return await this.contract.read.getMerkleProof([index]);
  }

  public async getMembershipInfo(
    idCommitmentBigInt: bigint
  ): Promise<MembershipInfo | undefined> {
    try {
      const membershipData = await this.contract.read.memberships([
        idCommitmentBigInt
      ]);

      const currentBlock = await this.rpcClient.getBlockNumber();

      const [
        depositAmount,
        activeDuration,
        gracePeriodStartTimestamp,
        gracePeriodDuration,
        rateLimit,
        index,
        holder,
        token
      ] = membershipData;

      const gracePeriodEnd =
        Number(gracePeriodStartTimestamp) + Number(gracePeriodDuration);

      let state: MembershipState;
      if (currentBlock < Number(gracePeriodStartTimestamp)) {
        state = MembershipState.Active;
      } else if (currentBlock < gracePeriodEnd) {
        state = MembershipState.GracePeriod;
      } else {
        state = MembershipState.Expired;
      }

      return {
        index,
        idCommitment: idCommitmentBigInt.toString(),
        rateLimit: rateLimit,
        startBlock: Number(gracePeriodStartTimestamp),
        endBlock: gracePeriodEnd,
        state,
        depositAmount,
        activeDuration,
        gracePeriodDuration,
        holder,
        token
      };
    } catch (error) {
      log.error("Error in getMembershipInfo:", error);
      return undefined;
    }
  }

  public async extendMembership(idCommitmentBigInt: bigint): Promise<Hash> {
    if (!this.rpcClient.account) {
      throw new Error(
        "Failed to extendMembership: no account set in wallet client"
      );
    }
    try {
      await this.contract.simulate.extendMemberships([[idCommitmentBigInt]], {
        chain: this.rpcClient.chain,
        account: (this.rpcClient as WalletClient).account!.address
      });
    } catch (err) {
      throw new Error("Simulating extending membership failed: " + err);
    }
    const hash = await this.contract.write.extendMemberships(
      [[idCommitmentBigInt]],
      {
        account: this.rpcClient.account!,
        chain: this.rpcClient.chain
      }
    );

    await this.rpcClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  public async eraseMembership(
    idCommitmentBigInt: bigint,
    eraseFromMembershipSet: boolean = true
  ): Promise<Hash> {
    if (
      !(await this.isExpired(idCommitmentBigInt)) ||
      !(await this.isInGracePeriod(idCommitmentBigInt))
    ) {
      throw new Error("Membership is not expired or in grace period");
    }
    if (!this.rpcClient.account) {
      throw new Error(
        "Failed to eraseMembership: no account set in wallet client"
      );
    }

    try {
      await this.contract.simulate.eraseMemberships(
        [[idCommitmentBigInt], eraseFromMembershipSet],
        {
          chain: this.rpcClient.chain,
          account: (this.rpcClient as WalletClient).account!.address
        }
      );
    } catch (err) {
      throw new Error("Error simulating eraseMemberships: " + err);
    }

    const hash = await this.contract.write.eraseMemberships(
      [[idCommitmentBigInt], eraseFromMembershipSet],
      {
        chain: this.rpcClient.chain,
        account: this.rpcClient.account!
      }
    );
    await this.rpcClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  public async registerMembership(
    idCommitmentBigInt: bigint,
    rateLimit: number = DEFAULT_RATE_LIMIT
  ): Promise<Hash> {
    if (
      rateLimit < RATE_LIMIT_PARAMS.MIN_RATE ||
      rateLimit > RATE_LIMIT_PARAMS.MAX_RATE
    ) {
      throw new Error(
        `Rate limit must be between ${RATE_LIMIT_PARAMS.MIN_RATE} and ${RATE_LIMIT_PARAMS.MAX_RATE}`
      );
    }
    if (!this.rpcClient.account) {
      throw new Error(
        "Failed to registerMembership: no account set in wallet client"
      );
    }
    try {
      await this.contract.simulate.register(
        [idCommitmentBigInt, rateLimit, []],
        {
          chain: this.rpcClient.chain,
          account: (this.rpcClient as WalletClient).account!.address
        }
      );
    } catch (err) {
      throw new Error("Failed to simulate register membership: " + err);
    }

    const hash = await this.contract.write.register(
      [idCommitmentBigInt, rateLimit, []],
      {
        chain: this.rpcClient.chain,
        account: this.rpcClient.account!
      }
    );
    await this.rpcClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /**
   * Withdraw deposited tokens after membership is erased
   * @param token - Token address to withdraw
   * NOTE: Funds are sent to msg.sender (the walletClient's address)
   */
  public async withdraw(token: string): Promise<Hash> {
    if (!this.rpcClient.account) {
      throw new Error("Failed to withdraw: no account set in wallet client");
    }

    try {
      await this.contract.simulate.withdraw([token as Address], {
        chain: this.rpcClient.chain,
        account: (this.rpcClient as WalletClient).account!.address
      });
    } catch (err) {
      throw new Error("Error simulating withdraw: " + err);
    }

    const hash = await this.contract.write.withdraw([token as Address], {
      chain: this.rpcClient.chain,
      account: this.rpcClient.account!
    });

    await this.rpcClient.waitForTransactionReceipt({ hash });
    return hash;
  }
  public async registerWithIdentity(
    identity: IdentityCredential
  ): Promise<DecryptedCredentials | undefined> {
    try {
      log.info(
        `Registering identity with rate limit: ${this.rateLimit} messages/epoch`
      );

      // Check if the ID commitment is already registered
      const existingIndex = await this.getMemberIndex(
        identity.IDCommitmentBigInt
      );
      if (existingIndex) {
        throw new Error(
          `ID commitment is already registered with index ${existingIndex}`
        );
      }

      // Check if there's enough remaining rate limit
      const remainingRateLimit = await this.getRemainingTotalRateLimit();
      if (remainingRateLimit < this.rateLimit) {
        throw new Error(
          `Not enough remaining rate limit. Requested: ${this.rateLimit}, Available: ${remainingRateLimit}`
        );
      }

      await this.contract.simulate.register(
        [identity.IDCommitmentBigInt, this.rateLimit, []],
        {
          chain: this.rpcClient.chain,
          account: (this.rpcClient as WalletClient).account!.address
        }
      );

      const hash: Hash = await this.contract.write.register(
        [identity.IDCommitmentBigInt, this.rateLimit, []],
        {
          chain: this.rpcClient.chain,
          account: this.rpcClient.account!
        }
      );

      const txRegisterReceipt = await this.rpcClient.waitForTransactionReceipt({
        hash
      });

      if (txRegisterReceipt.status === "reverted") {
        throw new Error("Transaction failed on-chain");
      }

      // Parse MembershipRegistered event from logs
      const memberRegisteredLog = txRegisterReceipt.logs.find((log) => {
        try {
          const decoded = decodeEventLog({
            abi: wakuRlnV2Abi,
            data: log.data,
            topics: log.topics
          });
          return decoded.eventName === "MembershipRegistered";
        } catch {
          return false;
        }
      });

      if (!memberRegisteredLog) {
        log.error(
          "Failed to register membership: No MembershipRegistered event found"
        );
        return undefined;
      }

      // Decode the event
      const decoded = decodeEventLog({
        abi: wakuRlnV2Abi,
        data: memberRegisteredLog.data,
        topics: memberRegisteredLog.topics
      });

      const decodedArgs = decoded.args as {
        idCommitment: bigint;
        membershipRateLimit: number;
        index: number;
      };

      log.info(
        `Successfully registered membership with index ${decodedArgs.index} ` +
          `and rate limit ${decodedArgs.membershipRateLimit}`
      );

      return {
        identity,
        membership: {
          address: this.contract.address,
          treeIndex: decodedArgs.index,
          chainId: String(RLN_CONTRACT.chainId),
          rateLimit: decodedArgs.membershipRateLimit
        }
      };
    } catch (error) {
      if (error instanceof Error) {
        const errorMessage = error.message;
        log.error("registerWithIdentity - error message:", errorMessage);
        log.error("registerWithIdentity - error stack:", error.stack);

        // Try to extract more specific error information
        if (errorMessage.includes("CannotExceedMaxTotalRateLimit")) {
          throw new Error(
            "Registration failed: Cannot exceed maximum total rate limit"
          );
        } else if (errorMessage.includes("InvalidIdCommitment")) {
          throw new Error("Registration failed: Invalid ID commitment");
        } else if (errorMessage.includes("InvalidMembershipRateLimit")) {
          throw new Error("Registration failed: Invalid membership rate limit");
        } else if (errorMessage.includes("execution reverted")) {
          throw new Error(
            "Contract execution reverted. Check contract requirements."
          );
        } else {
          throw new Error(`Error in registerWithIdentity: ${errorMessage}`);
        }
      } else {
        throw new Error("Unknown error in registerWithIdentity", {
          cause: error
        });
      }
    }
  }

  /**
   * Validates that the rate limit is within the allowed range (sync)
   * @throws Error if the rate limit is outside the allowed range
   */
  private validateRateLimit(rateLimit: number): void {
    if (this.minRateLimit === undefined || this.maxRateLimit === undefined) {
      throw new Error("Rate limits not initialized");
    }
    if (rateLimit < this.minRateLimit || rateLimit > this.maxRateLimit) {
      throw new Error(
        `Rate limit must be between ${this.minRateLimit} and ${this.maxRateLimit} messages per epoch`
      );
    }
  }

  private async getMemberIndex(idCommitmentBigInt: bigint): Promise<number> {
    return (await this.contract.read.memberships([idCommitmentBigInt]))[5];
  }

  public async getMembershipStatus(
    idCommitment: bigint
  ): Promise<"expired" | "grace" | "active"> {
    const [isExpired, isInGrace] = await Promise.all([
      this.contract.read.isExpired([idCommitment]),
      this.contract.read.isInGracePeriod([idCommitment])
    ]);

    if (isExpired) return "expired";
    if (isInGrace) return "grace";
    return "active";
  }

  /**
   * Checks if a membership is expired for the given idCommitment
   * @param idCommitmentBigInt The idCommitment as bigint
   * @returns Promise<boolean> True if expired, false otherwise
   */
  public async isExpired(idCommitmentBigInt: bigint): Promise<boolean> {
    try {
      return await this.contract.read.isExpired([idCommitmentBigInt]);
    } catch (error) {
      log.error("Error in isExpired:", error);
      return false;
    }
  }

  /**
   * Checks if a membership is in grace period for the given idCommitment
   * @param idCommitmentBigInt The idCommitment as bigint
   * @returns Promise<boolean> True if in grace period, false otherwise
   */
  public async isInGracePeriod(idCommitmentBigInt: bigint): Promise<boolean> {
    try {
      return await this.contract.read.isInGracePeriod([idCommitmentBigInt]);
    } catch (error) {
      log.error("Error in isInGracePeriod:", error);
      return false;
    }
  }

  /**
   * Calculates the price for a given rate limit using the PriceCalculator contract
   * @param rateLimit The rate limit to calculate the price for
   * @param contractFactory Optional factory for creating the contract (for testing)
   */
  public async getPriceForRateLimit(rateLimit: number): Promise<{
    token: string | null;
    price: bigint | null;
  }> {
    const address = await this.contract.read.priceCalculator();
    const [token, price] = await this.rpcClient.readContract({
      address,
      abi: iPriceCalculatorAbi,
      functionName: "calculate",
      args: [rateLimit]
    });

    // Defensive: if token or price is null/undefined, return nulls
    if (!token || !price) {
      return { token: null, price: null };
    }
    return { token, price };
  }
}
