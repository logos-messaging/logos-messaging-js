import { multiaddr } from "@multiformats/multiaddr";
import { createLightNode, Protocols } from "@waku/sdk";
import { expect } from "chai";

import { createRLNEncoder } from "./codec.js";
import { Keystore } from "./keystore/index.js";
import { RLNInstance } from "./rln.js";
import { BytesUtils } from "./utils/index.js";
import { getPathDirectionsFromIndex } from "./utils/merkle.js";
import { TEST_KEYSTORE_DATA } from "./utils/test_keystore.js";

interface NodeInfo {
  multiaddr: string;
  restPort: string;
  peerId: string;
}

interface FleetInfo {
  nodes: NodeInfo[];
}

async function getFleetInfo(): Promise<FleetInfo> {
  const response = await fetch("/base/fleet-info.json");
  if (!response.ok) {
    throw new Error(
      `Failed to fetch fleet info: ${response.status} ${response.statusText}. ` +
        "Make sure to start the nwaku fleet before running tests."
    );
  }
  return response.json();
}

describe("RLN Proof Integration Tests", function () {
  this.timeout(30000);

  it("sends a message with a proof", async function () {
    // Get fleet info from the pre-started nwaku nodes
    const fleetInfo = await getFleetInfo();
    expect(fleetInfo.nodes.length).to.be.greaterThanOrEqual(2);

    const waku = await createLightNode({
      networkConfig: {
        clusterId: 0,
        numShardsInCluster: 1
      },
      defaultBootstrap: false,
      libp2p: {
        filterMultiaddrs: false
      }
    });

    // Create RLN instance
    const rlnInstance = await RLNInstance.create();

    // Load credential from test keystore
    const keystore = Keystore.fromString(TEST_KEYSTORE_DATA.keystoreJson);
    if (!keystore) {
      throw new Error("Failed to load test keystore");
    }
    const credential = await keystore.readCredential(
      TEST_KEYSTORE_DATA.credentialHash,
      TEST_KEYSTORE_DATA.password
    );
    if (!credential) {
      throw new Error("Failed to unlock credential with provided password");
    }

    // Prepare merkle proof data
    const merkleProof = TEST_KEYSTORE_DATA.merkleProof.map((p) => BigInt(p));
    const membershipIndex = Number(TEST_KEYSTORE_DATA.membershipIndex);
    const rateLimit = Number(TEST_KEYSTORE_DATA.rateLimit);

    const proofElementIndexes = getPathDirectionsFromIndex(
      BigInt(membershipIndex)
    );

    // Convert merkle proof to bytes format
    const pathElements = merkleProof.map((proof) =>
      BytesUtils.bytes32FromBigInt(proof)
    );
    const identityPathIndex = proofElementIndexes.map((index) =>
      BytesUtils.writeUIntLE(new Uint8Array(1), index, 0, 1)
    );

    // Create base encoder
    const contentTopic = "/rln/1/test/proto";
    const baseEncoder = waku.createEncoder({
      contentTopic
    });

    // Create RLN encoder
    const rlnEncoder = createRLNEncoder({
      encoder: baseEncoder,
      rlnInstance,
      credential: credential.identity,
      pathElements,
      identityPathIndex,
      rateLimit
    });

    // Connect to all nodes in the fleet
    for (const nodeInfo of fleetInfo.nodes) {
      const nwakuMultiaddr = multiaddr(nodeInfo.multiaddr);
      await waku.dial(nwakuMultiaddr, [Protocols.LightPush]);
    }

    await waku.waitForPeers([Protocols.LightPush]);

    // Create message
    const messageTimestamp = new Date();
    const message = {
      payload: new TextEncoder().encode("Hello RLN!"),
      timestamp: messageTimestamp
    };

    // Send message with proof
    const result = await waku.lightPush.send(rlnEncoder, message);
    expect(result.successes.length).to.be.greaterThan(0);
  });
});
