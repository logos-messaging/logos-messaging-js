import { linearPriceCalculatorAbi, wakuRlnV2Abi } from "./wagmi/generated.js";

export const RLN_CONTRACT = {
  chainId: 59141,
  address: "0xb9cd878c90e49f797b4431fbf4fb333108cb90e6",
  abi: wakuRlnV2Abi
};

export const PRICE_CALCULATOR_CONTRACT = {
  chainId: 59141,
  address: "0xBcfC0660Df69f53ab409F32bb18A3fb625fcE644",
  abi: linearPriceCalculatorAbi
};

/**
 * Rate limit tiers (messages per epoch)
 * Each membership can specify a rate limit within these bounds.
 * @see https://github.com/waku-org/specs/blob/master/standards/core/rln-contract.md#implementation-suggestions
 */
export const RATE_LIMIT_TIERS = {
  STANDARD: 300,
  MAX: 600
} as const;

// Global rate limit parameters
export const RATE_LIMIT_PARAMS = {
  MIN_RATE: RATE_LIMIT_TIERS.STANDARD,
  MAX_RATE: RATE_LIMIT_TIERS.MAX,
  MAX_TOTAL_RATE: 160_000,
  EPOCH_LENGTH: 600
} as const;

export const DEFAULT_RATE_LIMIT = RATE_LIMIT_PARAMS.MAX_RATE;
