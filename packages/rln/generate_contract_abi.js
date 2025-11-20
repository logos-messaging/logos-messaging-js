import { execSync } from "child_process";
import { existsSync, rmSync } from "fs";
import { dirname, join } from "path";
import process from "process";
import { fileURLToPath } from "url";

// Get script directory (equivalent to BASH_SOURCE in bash)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTRACT_DIR = join(__dirname, "waku-rlnv2-contract");
const REPO_URL = "git@github.com:waku-org/waku-rlnv2-contract.git";

/**
 * Execute a shell command and print output in real-time
 * @param {string} command - The command to execute
 * @param {object} options - Options for execSync
 */
function exec(command, options = {}) {
  execSync(command, {
    stdio: "inherit",
    cwd: options.cwd || __dirname,
    ...options
  });
}

async function main() {
  try {
    console.log("📦 Setting up waku-rlnv2-contract...");

    // Remove existing directory if it exists
    if (existsSync(CONTRACT_DIR)) {
      console.log("🗑️  Removing existing waku-rlnv2-contract directory...");
      rmSync(CONTRACT_DIR, { recursive: true, force: true });
    }

    // Clone the repository
    console.log("📥 Cloning waku-rlnv2-contract...");
    exec(`git clone ${REPO_URL} ${CONTRACT_DIR}`);

    // Install dependencies
    console.log("📦 Installing dependencies...");
    exec("npm install", { cwd: CONTRACT_DIR });

    // Build contracts with Foundry
    console.log("🔨 Building contracts with Foundry...");
    exec("forge build", { cwd: CONTRACT_DIR });

    // Generate ABIs with wagmi
    console.log("⚙️  Generating ABIs with wagmi...");
    exec("npx wagmi generate");

    console.log("✅ Contract ABIs generated successfully!");
  } catch (error) {
    console.log(
      "❌ Error generating contract ABIs:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.log(error);
  process.exit(1);
});
