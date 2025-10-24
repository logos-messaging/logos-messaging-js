#!/bin/bash

set -e

# Script to generate contract ABIs from waku-rlnv2-contract
# Usage: ./generate_contract_abi.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_DIR="$SCRIPT_DIR/waku-rlnv2-contract"
REPO_URL="git@github.com:waku-org/waku-rlnv2-contract.git"

echo "📦 Setting up waku-rlnv2-contract..."

# Remove existing directory if it exists
if [ -d "$CONTRACT_DIR" ]; then
  echo "🗑️  Removing existing waku-rlnv2-contract directory..."
  rm -rf "$CONTRACT_DIR"
fi

# Clone the repository
echo "📥 Cloning waku-rlnv2-contract..."
git clone "$REPO_URL" "$CONTRACT_DIR"

# Navigate to contract directory
cd "$CONTRACT_DIR"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build contracts with Foundry
echo "🔨 Building contracts with Foundry..."
forge build

# Navigate back to rln package
cd "$SCRIPT_DIR"

# Generate ABIs with wagmi
echo "⚙️  Generating ABIs with wagmi..."
npx wagmi generate

echo "✅ Contract ABIs generated successfully!"
echo "📄 Output: src/contract/wagmi/generated.ts"
