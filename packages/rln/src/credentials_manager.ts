import { Logger } from "@waku/utils";
import { publicActions } from "viem";

import { RLN_CONTRACT } from "./contract/constants.js";
import { RLNBaseContract } from "./contract/rln_base_contract.js";
import { IdentityCredential } from "./identity.js";
import { Keystore } from "./keystore/index.js";
import type {
  DecryptedCredentials,
  EncryptedCredentials
} from "./keystore/index.js";
import { KeystoreEntity, Password } from "./keystore/types.js";
import { RegisterMembershipOptions, StartRLNOptions } from "./types.js";
import {
  BytesUtils,
  createViemClientFromWindow,
  getPathDirectionsFromIndex,
  RpcClient
} from "./utils/index.js";
import { Zerokit } from "./zerokit.js";

const log = new Logger("rln:credentials");

/**
 * Manages credentials for RLN
 * It is used to register membership and generate identity credentials
 */
export class RLNCredentialsManager {
  protected started = false;
  protected starting = false;

  public contract: undefined | RLNBaseContract;
  public rpcClient: undefined | RpcClient;

  protected keystore = Keystore.create();
  public credentials: undefined | DecryptedCredentials;
  public pathElements: undefined | Uint8Array[];
  public identityPathIndex: undefined | Uint8Array[];

  public zerokit: Zerokit;

  private unwatchRootStored?: () => void;
  private rootPollingInterval?: number = 5000;

  public constructor(zerokit: Zerokit) {
    log.info("RLNCredentialsManager initialized");
    this.zerokit = zerokit;
  }

  public async start(options: StartRLNOptions = {}): Promise<void> {
    if (this.started || this.starting) {
      log.info("RLNCredentialsManager already started or starting");
      return;
    }

    log.info("Starting RLNCredentialsManager");
    this.starting = true;

    try {
      const { credentials, keystore } =
        await RLNCredentialsManager.decryptCredentialsIfNeeded(
          options.credentials
        );

      if (credentials) {
        log.info("Credentials successfully decrypted");
      }

      const { rpcClient, address, rateLimit } =
        await this.determineStartOptions(options, credentials);

      log.info(`Using contract address: ${address}`);

      if (keystore) {
        this.keystore = keystore;
        log.info("Using provided keystore");
      }

      this.credentials = credentials;
      this.rpcClient = rpcClient!;
      this.contract = await RLNBaseContract.create({
        address: address! as `0x${string}`,
        rpcClient: this.rpcClient,
        rateLimit: rateLimit ?? this.zerokit.rateLimit
      });

      if (this.credentials) {
        await this.updateMerkleProof();
        await this.startWatchingRootStored();
      }

      log.info("RLNCredentialsManager successfully started");
      this.started = true;
    } catch (error) {
      log.error("Failed to start RLNCredentialsManager", error);
      throw error;
    } finally {
      this.starting = false;
    }
  }

  public async registerMembership(
    options: RegisterMembershipOptions
  ): Promise<undefined | DecryptedCredentials> {
    if (!this.contract) {
      log.error("RLN Contract is not initialized");
      throw Error("RLN Contract is not initialized.");
    }

    log.info("Registering membership");
    let identity = "identity" in options && options.identity;

    if ("signature" in options) {
      log.info("Using Zerokit to generate identity");
      const extendedIdentity = this.zerokit.generateSeededIdentityCredential(
        options.signature
      );
      identity = IdentityCredential.fromBytes(extendedIdentity.toBytesLE());
    }

    if (!identity) {
      log.error("Missing signature or identity to register membership");
      throw Error("Missing signature or identity to register membership.");
    }

    log.info("Registering identity with contract");
    return this.contract.registerWithIdentity(identity);
  }

  /**
   * Changes credentials in use by relying on provided Keystore earlier in rln.start
   * @param id: string, hash of credentials to select from Keystore
   * @param password: string or bytes to use to decrypt credentials from Keystore
   */
  public async useCredentials(id: string, password: Password): Promise<void> {
    log.info(`Attempting to use credentials with ID: ${id}`);
    this.credentials = await this.keystore?.readCredential(id, password);
    if (this.credentials) {
      log.info("Successfully loaded credentials");
    } else {
      log.warn("Failed to load credentials");
    }
  }

  protected async determineStartOptions(
    options: StartRLNOptions,
    credentials: KeystoreEntity | undefined
  ): Promise<StartRLNOptions & { rpcClient: RpcClient }> {
    let chainId = credentials?.membership.chainId;
    const address =
      credentials?.membership.address ||
      options.address ||
      RLN_CONTRACT.address;

    if (address === RLN_CONTRACT.address) {
      chainId = RLN_CONTRACT.chainId.toString();
      log.info(`Using Linea contract with chainId: ${chainId}`);
    }

    const rpcClient: RpcClient = options.walletClient
      ? options.walletClient.extend(publicActions)
      : await createViemClientFromWindow();

    const currentChainId = rpcClient.chain?.id;
    log.info(`Current chain ID: ${currentChainId}`);

    if (chainId && chainId !== currentChainId?.toString()) {
      log.error(
        `Chain ID mismatch: contract=${chainId}, current=${currentChainId}`
      );
      throw Error(
        `Failed to start RLN contract, chain ID of contract is different from current one: contract-${chainId}, current network-${currentChainId}`
      );
    }

    return {
      rpcClient,
      address
    };
  }

  protected static async decryptCredentialsIfNeeded(
    credentials?: EncryptedCredentials | DecryptedCredentials
  ): Promise<{ credentials?: DecryptedCredentials; keystore?: Keystore }> {
    if (!credentials) {
      log.info("No credentials provided");
      return {};
    }

    if ("identity" in credentials) {
      log.info("Using already decrypted credentials");
      return { credentials };
    }

    log.info("Attempting to decrypt credentials");
    const keystore = Keystore.fromString(credentials.keystore);

    if (!keystore) {
      log.warn("Failed to create keystore from string");
      return {};
    }

    try {
      const decryptedCredentials = await keystore.readCredential(
        credentials.id,
        credentials.password
      );
      log.info(`Successfully decrypted credentials with ID: ${credentials.id}`);

      return {
        keystore,
        credentials: decryptedCredentials
      };
    } catch (error) {
      log.error("Failed to decrypt credentials", error);
      throw error;
    }
  }

  protected async verifyCredentialsAgainstContract(
    credentials: KeystoreEntity
  ): Promise<void> {
    if (!this.contract || !this.rpcClient) {
      throw Error(
        "Failed to verify chain coordinates: no contract or viem client initialized."
      );
    }

    const registryAddress = credentials.membership.address;
    const currentRegistryAddress = this.contract.address;
    if (registryAddress !== currentRegistryAddress) {
      throw Error(
        `Failed to verify chain coordinates: credentials contract address=${registryAddress} is not equal to registryContract address=${currentRegistryAddress}`
      );
    }

    const chainId = credentials.membership.chainId;
    const currentChainId = await this.rpcClient.getChainId();
    if (chainId !== currentChainId.toString()) {
      throw Error(
        `Failed to verify chain coordinates: credentials chainID=${chainId} is not equal to registryContract chainID=${currentChainId}`
      );
    }
  }

  /**
   * Updates the Merkle proof for the current credentials
   * Fetches the latest proof from the contract and updates pathElements and identityPathIndex
   */
  private async updateMerkleProof(): Promise<void> {
    if (!this.contract || !this.credentials) {
      log.warn("Cannot update merkle proof: contract or credentials not set");
      return;
    }

    try {
      const treeIndex = this.credentials.membership.treeIndex;
      log.info(`Updating merkle proof for tree index: ${treeIndex}`);

      // Get the merkle proof from the contract
      const proof = await this.contract.getMerkleProof(treeIndex);

      // Convert bigint[] to Uint8Array[] for pathElements
      this.pathElements = proof.map((element) =>
        BytesUtils.bytes32FromBigInt(element, "little")
      );

      // Get path directions from the tree index
      const pathDirections = getPathDirectionsFromIndex(BigInt(treeIndex));

      // Convert path directions to Uint8Array[] for identityPathIndex
      this.identityPathIndex = pathDirections.map((direction: number) =>
        Uint8Array.from([direction])
      );

      log.info("Successfully updated merkle proof", {
        pathElementsCount: this.pathElements.length,
        pathIndexCount: this.identityPathIndex!.length
      });
    } catch (error) {
      log.error("Failed to update merkle proof:", error);
      throw error;
    }
  }

  /**
   * Starts watching for RootStored events and updates merkle proof when detected
   */
  private async startWatchingRootStored(): Promise<void> {
    if (!this.contract) {
      log.warn("Cannot watch for RootStored events: contract not set");
      return;
    }

    // Stop any existing watcher
    this.stopWatchingRootStored();

    log.info("Starting to watch for RootStored events");

    this.unwatchRootStored = await this.contract.watchRootStoredEvent(() => {
      // Update the merkle proof when root changes (fire-and-forget)
      this.updateMerkleProof().catch((error) => {
        log.error(
          "Failed to update merkle proof after RootStored event:",
          error
        );
      });
    }, this.rootPollingInterval);
  }

  /**
   * Stops watching for RootStored events
   */
  private stopWatchingRootStored(): void {
    if (this.unwatchRootStored) {
      log.info("Stopping RootStored event watcher");
      this.unwatchRootStored();
      this.unwatchRootStored = undefined;
    }
  }
}
