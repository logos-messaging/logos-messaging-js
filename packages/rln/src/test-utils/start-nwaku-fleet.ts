/* eslint-disable no-console */
/* eslint-disable import/no-extraneous-dependencies */
/**
 * Script to start a fleet of nwaku nodes for RLN integration tests.
 * Reuses the tests package infrastructure.
 *
 * Usage:
 *   npx ts-node --esm src/test-utils/start-nwaku-fleet.ts start [numNodes]
 *   npx ts-node --esm src/test-utils/start-nwaku-fleet.ts stop
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { ServiceNode } from "@waku/tests";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use WAKUNODE_IMAGE from environment or fall back to RLN-specific image
const NWAKU_IMAGE =
  process.env.WAKUNODE_IMAGE || "quay.io/wakuorg/nwaku-pr:3660";
process.env.WAKUNODE_IMAGE = NWAKU_IMAGE;

interface NodeInfo {
  multiaddr: string;
  restPort: string;
  peerId: string;
}

interface FleetInfo {
  nodes: NodeInfo[];
}

const FLEET_INFO_PATH = path.join(__dirname, "../../fleet-info.json");
const activeNodes: ServiceNode[] = [];

async function startFleet(numNodes: number = 2): Promise<FleetInfo> {
  console.log(
    `Starting fleet of ${numNodes} nwaku nodes with image: ${process.env.WAKUNODE_IMAGE}`
  );

  const nodes: NodeInfo[] = [];

  for (let i = 0; i < numNodes; i++) {
    const node = new ServiceNode(`rln_test_node_${i}_${Date.now()}`);

    const args: Record<string, unknown> = {
      relay: true,
      lightpush: true,
      filter: true,
      store: true,
      clusterId: 0,
      shard: [0]
    };

    // Connect subsequent nodes to the first node
    if (i > 0 && activeNodes[0]) {
      const firstNodeAddr = await activeNodes[0].getExternalMultiaddr();
      if (firstNodeAddr) {
        args.staticnode = firstNodeAddr;
      }
    }

    await node.start(args, { retries: 3 });
    activeNodes.push(node);

    const multiaddr = await node.getMultiaddrWithId();

    const nodeInfo: NodeInfo = {
      multiaddr: multiaddr.toString(),
      restPort: node.httpUrl,
      peerId: (await node.getPeerId()).toString()
    };

    nodes.push(nodeInfo);
    console.log(`Node ${i} started: ${nodeInfo.multiaddr}`);
  }

  const fleetInfo: FleetInfo = { nodes };

  // Write fleet info to file for the browser test to read
  fs.writeFileSync(FLEET_INFO_PATH, JSON.stringify(fleetInfo, null, 2));
  console.log(`Fleet info written to ${FLEET_INFO_PATH}`);

  return fleetInfo;
}

async function stopFleet(): Promise<void> {
  console.log("Stopping all nwaku nodes...");

  // Try to read the fleet info file to get node references
  // But since ServiceNode instances are in memory, we need to stop them directly
  for (const node of activeNodes) {
    try {
      await node.stop();
      console.log("Node stopped");
    } catch (err) {
      console.log(`Error stopping node: ${err}`);
    }
  }

  // Clean up the fleet info file
  if (fs.existsSync(FLEET_INFO_PATH)) {
    fs.unlinkSync(FLEET_INFO_PATH);
    console.log("Fleet info file removed");
  }

  console.log("Fleet stopped");
}

// Keep the process running after start
async function startAndWait(numNodes: number): Promise<void> {
  await startFleet(numNodes);

  console.log("\nFleet is running. Press Ctrl+C to stop.\n");

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT, stopping fleet...");
    void stopFleet().then(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    console.log("\nReceived SIGTERM, stopping fleet...");
    void stopFleet().then(() => process.exit(0));
  });

  // Keep process alive
  await new Promise(() => {});
}

// CLI interface
const command = process.argv[2];

if (command === "start") {
  const numNodes = parseInt(process.argv[3] || "2", 10);
  startAndWait(numNodes).catch((err) => {
    console.error("Failed to start fleet:", err);
    process.exit(1);
  });
} else if (command === "stop") {
  // Note: stop command won't work well since nodes are in-memory
  // The recommended way is to use Ctrl+C on the start command
  console.log("Use Ctrl+C on the running start command to stop the fleet");
  process.exit(0);
} else {
  console.log("Usage:");
  console.log(
    "  npx ts-node --esm src/test-utils/start-nwaku-fleet.ts start [numNodes]"
  );
  console.log("  # Press Ctrl+C to stop");
  process.exit(1);
}
