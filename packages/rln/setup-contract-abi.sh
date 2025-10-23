#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBMODULE_DIR="$SCRIPT_DIR/waku-rlnv2-contract"

echo "Setting up waku-rlnv2-contract submodule..."

# Initialize submodule if needed
if [ ! -d "$SUBMODULE_DIR/.git" ]; then
    echo "Initializing submodule..."
    cd "$SCRIPT_DIR/../.."
    git submodule update --init --recursive packages/rln/waku-rlnv2-contract
fi

# Install dependencies
echo "Installing submodule dependencies..."
cd "$SUBMODULE_DIR"
npm install

# Build contracts with Foundry
echo "Building contracts with Foundry..."
forge build

# Generate ABIs
echo "Generating contract ABIs..."
cd "$SCRIPT_DIR"
npx wagmi generate

echo "✅ Contract ABI setup complete!"
