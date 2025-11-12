import {
  createWalletClient,
  custom,
  publicActions,
  PublicClient,
  WalletClient
} from "viem";
import { type Chain, lineaSepolia } from "viem/chains";

export const createViemClientFromWindow = async (
  chain: Chain = lineaSepolia
): Promise<WalletClient & PublicClient> => {
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
    chain,
    transport: custom(ethereum)
  }).extend(publicActions);

  return rpcClient;
};
