/* eslint-env node */

/**
 * Integration test runner for RLN package.
 *
 * This script:
 * 1. Pulls the specific nwaku Docker image
 * 2. Starts a fleet of nwaku nodes
 * 3. Runs the Karma browser tests
 * 4. Stops the fleet (cleanup)
 *
 * Usage: node src/test-utils/run-integration-tests.js
 */

import { exec, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use WAKUNODE_IMAGE from environment (set by CI) or fall back to our RLN-specific image
const NWAKU_IMAGE = "quay.io/wakuorg/nwaku-pr:3660";
const FLEET_INFO_PATH = path.join(__dirname, "../../fleet-info.json");
const NUM_NODES = 2;

// Ensure the environment variable is set for ServiceNode
process.env.WAKUNODE_IMAGE = NWAKU_IMAGE;

async function pullImage() {
  try {
    await execAsync(`docker inspect ${NWAKU_IMAGE}`);
  } catch {
    await execAsync(`docker pull ${NWAKU_IMAGE}`);
  }
}

async function startFleet() {
  const { ServiceNode } = await import("@waku/tests");

  const nodes = [];
  const nodeInfos = [];

  for (let i = 0; i < NUM_NODES; i++) {
    const node = new ServiceNode(`rln_integration_${i}_${Date.now()}`);

    const args = {
      relay: true,
      lightpush: true,
      filter: true,
      store: true,
      clusterId: 0,
      shard: [0]
    };

    // Connect subsequent nodes to the first node
    if (i > 0 && nodes[0]) {
      const firstNodeAddr = await nodes[0].getExternalMultiaddr();
      if (firstNodeAddr) {
        args.staticnode = firstNodeAddr;
      }
    }

    await node.start(args, { retries: 3 });
    nodes.push(node);

    const multiaddr = await node.getMultiaddrWithId();
    const peerId = await node.getPeerId();

    nodeInfos.push({
      multiaddr: multiaddr.toString(),
      restPort: node.httpUrl,
      peerId: peerId.toString()
    });
  }

  // Write fleet info to file
  const fleetInfo = { nodes: nodeInfos };
  fs.writeFileSync(FLEET_INFO_PATH, JSON.stringify(fleetInfo, null, 2));
  return nodes;
}

async function runKarmaTests() {
  return new Promise((resolve, reject) => {
    const karma = spawn("npx", ["karma", "start", "karma.node.conf.cjs"], {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "test"
      }
    });

    karma.on("error", (error) => {
      reject(new Error(`Karma failed to start: ${error.message}`));
    });

    karma.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Karma tests failed with exit code ${code}`));
      }
    });
  });
}

async function stopFleet(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    await nodes[i].stop();
  }

  // Clean up fleet info file
  if (fs.existsSync(FLEET_INFO_PATH)) {
    fs.unlinkSync(FLEET_INFO_PATH);
  }
}

async function main() {
  let nodes = [];
  let exitCode = 0;

  try {
    // Pull the Docker image
    await pullImage();

    // Start the fleet
    nodes = await startFleet();

    // Run the tests
    await runKarmaTests();
  } catch (error) {
    exitCode = 1;
  } finally {
    if (nodes.length > 0) {
      await stopFleet(nodes);
    }
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
