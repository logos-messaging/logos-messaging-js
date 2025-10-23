import { Logger } from "@waku/utils";
import { ethers } from "ethers";

import { IdentityCredential } from "../identity.js";
import { DecryptedCredentials } from "../keystore/types.js";

import {
  DEFAULT_RATE_LIMIT,
  PRICE_CALCULATOR_CONTRACT,
  RATE_LIMIT_PARAMS,
  RLN_CONTRACT
} from "./constants.js";
import {
  CustomQueryOptions,
  FetchMembersOptions,
  Member,
  MembershipInfo,
  MembershipRegisteredEvent,
  MembershipState,
  RLNContractInitOptions
} from "./types.js";

const log = new Logger("rln:contract:base");

export class RLNBaseContract {
  public contract: ethers.Contract;
  private deployBlock: undefined | number;
  private rateLimit: number;
  private minRateLimit?: number;
  private maxRateLimit?: number;

  protected _members: Map<number, Member> = new Map();
  private _membersFilter: ethers.EventFilter;
  private _membershipErasedFilter: ethers.EventFilter;
  private _membersExpiredFilter: ethers.EventFilter;

  /**
   * Private constructor for RLNBaseContract. Use static create() instead.
   */
  protected constructor(options: RLNContractInitOptions) {
    const {
      address,
      signer,
      rateLimit = DEFAULT_RATE_LIMIT,
      contract
    } = options;

    log.info("Initializing RLNBaseContract", { address, rateLimit });

    this.contract =
      contract || new ethers.Contract(address, RLN_CONTRACT.abi, signer);
    this.rateLimit = rateLimit;

    try {
      log.info("Setting up event filters");
      // Initialize event filters
      this._membersFilter = this.contract.filters.MembershipRegistered();
      this._membershipErasedFilter = this.contract.filters.MembershipErased();
      this._membersExpiredFilter = this.contract.filters.MembershipExpired();
      log.info("Event filters initialized successfully");
    } catch (error) {
      log.error("Failed to initialize event filters", { error });
      throw new Error(
        "Failed to initialize event filters: " + (error as Error).message
      );
    }

    // Initialize members and subscriptions
    this.fetchMembers()
      .then(() => {
        this.subscribeToMembers();
      })
      .catch((error) => {
        log.error("Failed to initialize members", { error });
      });
  }

  /**
   * Static async factory to create and initialize RLNBaseContract
   */
  public static async create(
    options: RLNContractInitOptions
  ): Promise<RLNBaseContract> {
    const instance = new RLNBaseContract(options);
    const [min, max] = await Promise.all([
      instance.contract.minMembershipRateLimit(),
      instance.contract.maxMembershipRateLimit()
    ]);
    instance.minRateLimit = ethers.BigNumber.from(min).toNumber();
    instance.maxRateLimit = ethers.BigNumber.from(max).toNumber();

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
   * Gets the contract provider
   */
  public get provider(): ethers.providers.Provider {
    return this.contract.provider;
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
    const maxTotalRate = await this.contract.maxTotalRateLimit();
    return maxTotalRate.toNumber();
  }

  /**
   * Gets the current total rate limit usage across all memberships
   * @returns Promise<number> The current total rate limit usage in messages per epoch
   */
  public async getCurrentTotalRateLimit(): Promise<number> {
    const currentTotal = await this.contract.currentTotalRateLimit();
    return currentTotal.toNumber();
  }

  /**
   * Gets the remaining available total rate limit that can be allocated
   * @returns Promise<number> The remaining rate limit that can be allocated
   */
  public async getRemainingTotalRateLimit(): Promise<number> {
    const [maxTotal, currentTotal] = await Promise.all([
      this.contract.maxTotalRateLimit(),
      this.contract.currentTotalRateLimit()
    ]);
    return Number(maxTotal) - Number(currentTotal);
  }

  /**
   * Updates the rate limit for future registrations
   * @param newRateLimit The new rate limit to use
   */
  public setRateLimit(newRateLimit: number): void {
    this.validateRateLimit(newRateLimit);
    this.rateLimit = newRateLimit;
  }

  public get members(): Member[] {
    const sortedMembers = Array.from(this._members.values()).sort(
      (left, right) => left.index.toNumber() - right.index.toNumber()
    );
    return sortedMembers;
  }

  public async fetchMembers(options: FetchMembersOptions = {}): Promise<void> {
    const registeredMemberEvents = await RLNBaseContract.queryFilter(
      this.contract,
      {
        fromBlock: this.deployBlock,
        ...options,
        membersFilter: this.membersFilter
      }
    );
    const removedMemberEvents = await RLNBaseContract.queryFilter(
      this.contract,
      {
        fromBlock: this.deployBlock,
        ...options,
        membersFilter: this.membershipErasedFilter
      }
    );
    const expiredMemberEvents = await RLNBaseContract.queryFilter(
      this.contract,
      {
        fromBlock: this.deployBlock,
        ...options,
        membersFilter: this.membersExpiredFilter
      }
    );

    const events = [
      ...registeredMemberEvents,
      ...removedMemberEvents,
      ...expiredMemberEvents
    ];
    this.processEvents(events);
  }

  public static async queryFilter(
    contract: ethers.Contract,
    options: CustomQueryOptions
  ): Promise<ethers.Event[]> {
    const FETCH_CHUNK = 5;
    const BLOCK_RANGE = 3000;

    const {
      fromBlock,
      membersFilter,
      fetchRange = BLOCK_RANGE,
      fetchChunks = FETCH_CHUNK
    } = options;

    if (fromBlock === undefined) {
      return contract.queryFilter(membersFilter);
    }

    if (!contract.provider) {
      throw Error("No provider found on the contract.");
    }

    const toBlock = await contract.provider.getBlockNumber();

    if (toBlock - fromBlock < fetchRange) {
      return contract.queryFilter(membersFilter, fromBlock, toBlock);
    }

    const events: ethers.Event[][] = [];
    const chunks = RLNBaseContract.splitToChunks(
      fromBlock,
      toBlock,
      fetchRange
    );

    for (const portion of RLNBaseContract.takeN<[number, number]>(
      chunks,
      fetchChunks
    )) {
      const promises = portion.map(([left, right]) =>
        RLNBaseContract.ignoreErrors(
          contract.queryFilter(membersFilter, left, right),
          []
        )
      );
      const fetchedEvents = await Promise.all(promises);
      events.push(fetchedEvents.flatMap((v) => v));
    }

    return events.flatMap((v) => v);
  }

  public processEvents(events: ethers.Event[]): void {
    const toRemoveTable = new Map<number, number[]>();
    const toInsertTable = new Map<number, ethers.Event[]>();

    events.forEach((evt) => {
      if (!evt.args) {
        return;
      }

      if (
        evt.event === "MembershipErased" ||
        evt.event === "MembershipExpired"
      ) {
        let index = evt.args.index;

        if (!index) {
          return;
        }

        if (typeof index === "number" || typeof index === "string") {
          index = ethers.BigNumber.from(index);
        }

        const toRemoveVal = toRemoveTable.get(evt.blockNumber);
        if (toRemoveVal != undefined) {
          toRemoveVal.push(index.toNumber());
          toRemoveTable.set(evt.blockNumber, toRemoveVal);
        } else {
          toRemoveTable.set(evt.blockNumber, [index.toNumber()]);
        }
      } else if (evt.event === "MembershipRegistered") {
        let eventsPerBlock = toInsertTable.get(evt.blockNumber);
        if (eventsPerBlock == undefined) {
          eventsPerBlock = [];
        }

        eventsPerBlock.push(evt);
        toInsertTable.set(evt.blockNumber, eventsPerBlock);
      }
    });
  }

  public static splitToChunks(
    from: number,
    to: number,
    step: number
  ): Array<[number, number]> {
    const chunks: Array<[number, number]> = [];

    let left = from;
    while (left < to) {
      const right = left + step < to ? left + step : to;

      chunks.push([left, right] as [number, number]);

      left = right;
    }

    return chunks;
  }

  public static *takeN<T>(array: T[], size: number): Iterable<T[]> {
    let start = 0;

    while (start < array.length) {
      const portion = array.slice(start, start + size);

      yield portion;

      start += size;
    }
  }

  public static async ignoreErrors<T>(
    promise: Promise<T>,
    defaultValue: T
  ): Promise<T> {
    try {
      return await promise;
    } catch (err: unknown) {
      if (err instanceof Error) {
        log.info(`Ignoring an error during query: ${err.message}`);
      } else {
        log.info(`Ignoring an unknown error during query`);
      }
      return defaultValue;
    }
  }

  public subscribeToMembers(): void {
    this.contract.on(
      this.membersFilter,
      (
        _idCommitment: bigint,
        _membershipRateLimit: ethers.BigNumber,
        _index: ethers.BigNumber,
        event: ethers.Event
      ) => {
        this.processEvents([event]);
      }
    );

    this.contract.on(
      this.membershipErasedFilter,
      (
        _idCommitment: bigint,
        _membershipRateLimit: ethers.BigNumber,
        _index: ethers.BigNumber,
        event: ethers.Event
      ) => {
        this.processEvents([event]);
      }
    );

    this.contract.on(
      this.membersExpiredFilter,
      (
        _idCommitment: bigint,
        _membershipRateLimit: ethers.BigNumber,
        _index: ethers.BigNumber,
        event: ethers.Event
      ) => {
        this.processEvents([event]);
      }
    );
  }

  public async getMembershipInfo(
    idCommitmentBigInt: bigint
  ): Promise<MembershipInfo | undefined> {
    try {
      const membershipData =
        await this.contract.memberships(idCommitmentBigInt);
      const currentBlock = await this.contract.provider.getBlockNumber();
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

      const gracePeriodEnd = gracePeriodStartTimestamp.add(gracePeriodDuration);

      let state: MembershipState;
      if (currentBlock < gracePeriodStartTimestamp.toNumber()) {
        state = MembershipState.Active;
      } else if (currentBlock < gracePeriodEnd.toNumber()) {
        state = MembershipState.GracePeriod;
      } else {
        state = MembershipState.Expired;
      }

      return {
        index,
        idCommitment: idCommitmentBigInt.toString(),
        rateLimit: Number(rateLimit),
        startBlock: gracePeriodStartTimestamp.toNumber(),
        endBlock: gracePeriodEnd.toNumber(),
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

  public async extendMembership(
    idCommitmentBigInt: bigint
  ): Promise<ethers.ContractTransaction> {
    const tx = await this.contract.extendMemberships([idCommitmentBigInt]);
    await tx.wait();
    return tx;
  }

  public async eraseMembership(
    idCommitmentBigInt: bigint,
    eraseFromMembershipSet: boolean = true
  ): Promise<ethers.ContractTransaction> {
    if (
      !(await this.isExpired(idCommitmentBigInt)) ||
      !(await this.isInGracePeriod(idCommitmentBigInt))
    ) {
      throw new Error("Membership is not expired or in grace period");
    }

    const estimatedGas = await this.contract.estimateGas[
      "eraseMemberships(uint256[],bool)"
    ]([idCommitmentBigInt], eraseFromMembershipSet);
    const gasLimit = estimatedGas.add(10000);

    const tx = await this.contract["eraseMemberships(uint256[],bool)"](
      [idCommitmentBigInt],
      eraseFromMembershipSet,
      { gasLimit }
    );
    await tx.wait();
    return tx;
  }

  public async registerMembership(
    idCommitmentBigInt: bigint,
    rateLimit: number = DEFAULT_RATE_LIMIT
  ): Promise<ethers.ContractTransaction> {
    if (
      rateLimit < RATE_LIMIT_PARAMS.MIN_RATE ||
      rateLimit > RATE_LIMIT_PARAMS.MAX_RATE
    ) {
      throw new Error(
        `Rate limit must be between ${RATE_LIMIT_PARAMS.MIN_RATE} and ${RATE_LIMIT_PARAMS.MAX_RATE}`
      );
    }
    return this.contract.register(idCommitmentBigInt, rateLimit, []);
  }

  public async withdraw(token: string, walletAddress: string): Promise<void> {
    try {
      const tx = await this.contract.withdraw(token, walletAddress);
      await tx.wait();
    } catch (error) {
      log.error(`Error in withdraw: ${(error as Error).message}`);
    }
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

      const estimatedGas = await this.contract.estimateGas.register(
        identity.IDCommitmentBigInt,
        this.rateLimit,
        []
      );
      const gasLimit = estimatedGas.add(10000);

      const txRegisterResponse: ethers.ContractTransaction =
        await this.contract.register(
          identity.IDCommitmentBigInt,
          this.rateLimit,
          [],
          {
            gasLimit
          }
        );

      const txRegisterReceipt = await txRegisterResponse.wait();

      if (txRegisterReceipt.status === 0) {
        throw new Error("Transaction failed on-chain");
      }

      const memberRegistered = txRegisterReceipt.events?.find(
        (event: ethers.Event) => event.event === "MembershipRegistered"
      );

      if (!memberRegistered || !memberRegistered.args) {
        log.error(
          "Failed to register membership: No MembershipRegistered event found"
        );
        return undefined;
      }

      const decodedData: MembershipRegisteredEvent = {
        idCommitment: memberRegistered.args.idCommitment,
        membershipRateLimit: memberRegistered.args.membershipRateLimit,
        index: memberRegistered.args.index
      };

      log.info(
        `Successfully registered membership with index ${decodedData.index} ` +
          `and rate limit ${decodedData.membershipRateLimit}`
      );

      const network = await this.contract.provider.getNetwork();
      const address = this.contract.address;
      const membershipId = Number(decodedData.index);

      return {
        identity,
        membership: {
          address,
          treeIndex: membershipId,
          chainId: network.chainId.toString(),
          rateLimit: decodedData.membershipRateLimit.toNumber()
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

  public async registerWithPermitAndErase(
    identity: IdentityCredential,
    permit: {
      owner: string;
      deadline: number;
      v: number;
      r: string;
      s: string;
    },
    idCommitmentsToErase: string[]
  ): Promise<DecryptedCredentials | undefined> {
    try {
      log.info(
        `Registering identity with permit and rate limit: ${this.rateLimit} messages/epoch`
      );

      const txRegisterResponse: ethers.ContractTransaction =
        await this.contract.registerWithPermit(
          permit.owner,
          permit.deadline,
          permit.v,
          permit.r,
          permit.s,
          identity.IDCommitmentBigInt,
          this.rateLimit,
          idCommitmentsToErase.map((id) => ethers.BigNumber.from(id))
        );
      const txRegisterReceipt = await txRegisterResponse.wait();

      const memberRegistered = txRegisterReceipt.events?.find(
        (event: ethers.Event) => event.event === "MembershipRegistered"
      );

      if (!memberRegistered || !memberRegistered.args) {
        log.error(
          "Failed to register membership with permit: No MembershipRegistered event found"
        );
        return undefined;
      }

      const decodedData: MembershipRegisteredEvent = {
        idCommitment: memberRegistered.args.idCommitment,
        membershipRateLimit: memberRegistered.args.membershipRateLimit,
        index: memberRegistered.args.index
      };

      log.info(
        `Successfully registered membership with permit. Index: ${decodedData.index}, ` +
          `Rate limit: ${decodedData.membershipRateLimit}, Erased ${idCommitmentsToErase.length} commitments`
      );

      const network = await this.contract.provider.getNetwork();
      const address = this.contract.address;
      const membershipId = Number(decodedData.index);

      return {
        identity,
        membership: {
          address,
          treeIndex: membershipId,
          chainId: network.chainId.toString(),
          rateLimit: decodedData.membershipRateLimit.toNumber()
        }
      };
    } catch (error) {
      log.error(
        `Error in registerWithPermitAndErase: ${(error as Error).message}`
      );
      return undefined;
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

  private get membersFilter(): ethers.EventFilter {
    if (!this._membersFilter) {
      throw Error("Members filter was not initialized.");
    }
    return this._membersFilter;
  }

  private get membershipErasedFilter(): ethers.EventFilter {
    if (!this._membershipErasedFilter) {
      throw Error("MembershipErased filter was not initialized.");
    }
    return this._membershipErasedFilter;
  }

  private get membersExpiredFilter(): ethers.EventFilter {
    if (!this._membersExpiredFilter) {
      throw Error("MembersExpired filter was not initialized.");
    }
    return this._membersExpiredFilter;
  }

  private async getMemberIndex(
    idCommitmentBigInt: bigint
  ): Promise<ethers.BigNumber | undefined> {
    try {
      const events = await this.contract.queryFilter(
        this.contract.filters.MembershipRegistered(idCommitmentBigInt)
      );
      if (events.length === 0) return undefined;

      // Get the most recent registration event
      const event = events[events.length - 1];
      return event.args?.index;
    } catch (error) {
      return undefined;
    }
  }

  public async getMembershipStatus(
    idCommitment: bigint
  ): Promise<"expired" | "grace" | "active"> {
    const [isExpired, isInGrace] = await Promise.all([
      this.contract.isExpired(idCommitment),
      this.contract.isInGracePeriod(idCommitment)
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
      return await this.contract.isExpired(idCommitmentBigInt);
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
      return await this.contract.isInGracePeriod(idCommitmentBigInt);
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
  public async getPriceForRateLimit(
    rateLimit: number,
    contractFactory?: typeof import("ethers").Contract
  ): Promise<{
    token: string | null;
    price: import("ethers").BigNumber | null;
  }> {
    const provider = this.contract.provider;
    const ContractCtor = contractFactory || ethers.Contract;
    const priceCalculator = new ContractCtor(
      PRICE_CALCULATOR_CONTRACT.address,
      PRICE_CALCULATOR_CONTRACT.abi,
      provider
    );
    const [token, price] = await priceCalculator.calculate(rateLimit);
    // Defensive: if token or price is null/undefined, return nulls
    if (!token || !price) {
      return { token: null, price: null };
    }
    return { token, price };
  }
}
