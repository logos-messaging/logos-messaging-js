# @waku/rln

Rate Limiting Nullifier (RLN) implementation for Waku.

## Description

This package provides RLN functionality for the Waku protocol, enabling rate-limiting capabilities while preserving privacy.

## Installation

```bash
npm install @waku/rln
```

## Smart Contract Type Generation

We use `wagmi` to generate TypeScript bindings for interacting with the RLN smart contracts.

When changes are pushed to the `waku-rlnv2-contract` repository, run the following script to fetch and build the latest contracts and generate the TypeScript bindings:

```
npm run setup:contract-abi
```

Note that we commit/bundle the generated typings, so it's not necessary to run this script unless the contracts are updated.

## Usage

```typescript
import { RLN } from '@waku/rln';

// Usage examples coming soon
```

## License

MIT OR Apache-2.0 
