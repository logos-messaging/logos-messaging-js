import "viem/window";
import {
  type Address,
  createWalletClient,
  custom,
  PublicActions,
  publicActions,
  WalletClient
} from "viem";
import { lineaSepolia } from "viem/chains";

export type RpcClient = WalletClient & PublicActions;

/**
 * Checks window for injected Ethereum provider, requests user to connect, and creates an RPC client object
 * capable of performing both read and write operations on the blockchain.
 *
 * If the wallet is not connected to the Linea Sepolia network, it will attempt to switch to it.
 * If the wallet does not have the Linea Sepolia network added, it will attempt to add it.
 */
export const createViemClientFromWindow = async (): Promise<RpcClient> => {
  const ethereum = window.ethereum;

  if (!ethereum) {
    throw Error(
      "Missing or invalid Ethereum provider. Please install a Web3 wallet such as MetaMask."
    );
  }

  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts)) {
    throw Error("Failed to get accounts");
  }
  const account = accounts[0] as Address;

  const rpcClient: RpcClient = createWalletClient({
    account: account as Address,
    chain: lineaSepolia,
    transport: custom(window.ethereum!)
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
      await rpcClient.switchChain({ id: lineaSepolia.id });
    } else {
      throw error;
    }
  }

  return rpcClient;
};
