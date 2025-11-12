import {
  createWalletClient,
  custom,
  publicActions,
  PublicClient,
  WalletClient
} from "viem";
import { lineaSepolia } from "viem/chains";

export const createViemClientFromWindow = async (): Promise<
  WalletClient & PublicClient
> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ethereum = (window as any).ethereum;

  if (!ethereum) {
    throw Error(
      "Missing or invalid Ethereum provider. Please install a Web3 wallet such as MetaMask."
    );
  }

  const [account] = await ethereum.request({ method: "eth_requestAccounts" });

  const rpcClient = createWalletClient({
    account,
    chain: lineaSepolia,
    transport: custom(ethereum)
  }).extend(publicActions);

  // Ensure wallet is connected to Linea Sepolia
  try {
    await rpcClient.switchChain({ id: lineaSepolia.id });
  } catch (error: unknown) {
    // This error code indicates that the chain has not been added to the wallet
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 4902
    ) {
      await rpcClient.addChain({ chain: lineaSepolia });
    } else {
      throw error;
    }
  }

  return rpcClient;
};
