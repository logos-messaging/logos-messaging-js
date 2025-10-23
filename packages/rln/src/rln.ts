import { Logger } from "@waku/utils";
import init, * as zerokitRLN from "@waku/zerokit-rln-wasm";
import initUtils from "@waku/zerokit-rln-wasm-utils";

import { DEFAULT_RATE_LIMIT } from "./contract/constants.js";
import { RLNCredentialsManager } from "./credentials_manager.js";
import * as wc from "./resources/witness_calculator";
import { WitnessCalculator } from "./resources/witness_calculator";
import { Zerokit } from "./zerokit.js";

const log = new Logger("rln");

export class RLNInstance extends RLNCredentialsManager {
  /**
   * Create an instance of RLN
   * @returns RLNInstance
   */
  public static async create(): Promise<RLNInstance> {
    try {
      await initUtils();
      await init();
      zerokitRLN.initPanicHook();

      const witnessCalculator = await RLNInstance.loadWitnessCalculator();
      const zkey = await RLNInstance.loadZkey();

      const zkRLN = zerokitRLN.newRLN(zkey);
      const zerokit = new Zerokit(zkRLN, witnessCalculator, DEFAULT_RATE_LIMIT);

      return new RLNInstance(zerokit);
    } catch (error) {
      log.error("Failed to initialize RLN:", error);
      throw error;
    }
  }

  private constructor(public zerokit: Zerokit) {
    super(zerokit);
  }

  public static async loadWitnessCalculator(): Promise<WitnessCalculator> {
    try {
      const url = new URL("./resources/rln.wasm", import.meta.url);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch witness calculator: ${response.status} ${response.statusText}`
        );
      }

      return await wc.builder(
        new Uint8Array(await response.arrayBuffer()),
        false
      );
    } catch (error) {
      log.error("Error loading witness calculator:", error);
      throw new Error(
        `Failed to load witness calculator: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  public static async loadZkey(): Promise<Uint8Array> {
    try {
      const url = new URL("./resources/rln_final.zkey", import.meta.url);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch zkey: ${response.status} ${response.statusText}`
        );
      }

      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      log.error("Error loading zkey:", error);
      throw new Error(
        `Failed to load zkey: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
