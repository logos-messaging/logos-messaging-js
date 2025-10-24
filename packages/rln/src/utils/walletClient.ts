import {
  createPublicClient,
  createWalletClient,
  custom,
  PublicClient,
  WalletClient
} from "viem";
import { type Chain, lineaSepolia } from "viem/chains";

export const createViemClientsFromWindow = async (
  chain: Chain = lineaSepolia
): Promise<{ walletClient: WalletClient; publicClient: PublicClient }> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ethereum = (window as any).ethereum;

  if (!ethereum) {
    throw Error(
      "Missing or invalid Ethereum provider. Please install a Web3 wallet such as MetaMask."
    );
  }

  const [account] = await ethereum.request({ method: "eth_requestAccounts" });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: custom(ethereum)
  });

  const publicClient = createPublicClient({
    chain,
    transport: custom(ethereum)
  });

  return { walletClient, publicClient };
};
