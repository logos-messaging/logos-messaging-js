import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

export default defineConfig({
  out: "src/contract/wagmi/generated.ts",
  plugins: [
    foundry({
      project: "./waku-rlnv2-contract",
      artifacts: "out",
      include: [
        "WakuRlnV2.sol/**",
        "Membership.sol/**",
        "LinearPriceCalculator.sol/**",
        "IPriceCalculator.sol/**"
      ]
    })
  ]
});
