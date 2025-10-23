//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IPriceCalculator
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iPriceCalculatorAbi = [
  {
    type: "function",
    inputs: [{ name: "_rateLimit", internalType: "uint32", type: "uint32" }],
    name: "calculate",
    outputs: [
      { name: "", internalType: "address", type: "address" },
      { name: "", internalType: "uint256", type: "uint256" }
    ],
    stateMutability: "view"
  }
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// LinearPriceCalculator
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const linearPriceCalculatorAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_token", internalType: "address", type: "address" },
      {
        name: "_pricePerMessagePerEpoch",
        internalType: "uint256",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [{ name: "_rateLimit", internalType: "uint32", type: "uint32" }],
    name: "calculate",
    outputs: [
      { name: "", internalType: "address", type: "address" },
      { name: "", internalType: "uint256", type: "uint256" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "pricePerMessagePerEpoch",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [
      { name: "_token", internalType: "address", type: "address" },
      {
        name: "_pricePerMessagePerEpoch",
        internalType: "uint256",
        type: "uint256"
      }
    ],
    name: "setTokenAndPrice",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [],
    name: "token",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true
      }
    ],
    name: "OwnershipTransferred"
  },
  { type: "error", inputs: [], name: "OnlyTokensAllowed" }
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// MembershipUpgradeable
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const membershipUpgradeableAbi = [
  {
    type: "function",
    inputs: [],
    name: "activeDurationForNewMemberships",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "currentTotalRateLimit",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      { name: "holder", internalType: "address", type: "address" },
      { name: "token", internalType: "address", type: "address" }
    ],
    name: "depositsToWithdraw",
    outputs: [{ name: "balance", internalType: "uint256", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "gracePeriodDurationForNewMemberships",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    name: "indicesOfLazilyErasedMemberships",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      { name: "_idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "isExpired",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      { name: "_idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "isInGracePeriod",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [{ name: "rateLimit", internalType: "uint32", type: "uint32" }],
    name: "isValidMembershipRateLimit",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "maxMembershipRateLimit",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "maxTotalRateLimit",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      { name: "_idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "membershipExpirationTimestamp",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      { name: "idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "memberships",
    outputs: [
      { name: "depositAmount", internalType: "uint256", type: "uint256" },
      { name: "activeDuration", internalType: "uint32", type: "uint32" },
      {
        name: "gracePeriodStartTimestamp",
        internalType: "uint256",
        type: "uint256"
      },
      { name: "gracePeriodDuration", internalType: "uint32", type: "uint32" },
      { name: "rateLimit", internalType: "uint32", type: "uint32" },
      { name: "index", internalType: "uint32", type: "uint32" },
      { name: "holder", internalType: "address", type: "address" },
      { name: "token", internalType: "address", type: "address" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "minMembershipRateLimit",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "nextFreeIndex",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "priceCalculator",
    outputs: [
      { name: "", internalType: "contract IPriceCalculator", type: "address" }
    ],
    stateMutability: "view"
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      { name: "version", internalType: "uint8", type: "uint8", indexed: false }
    ],
    name: "Initialized"
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "idCommitment",
        internalType: "uint256",
        type: "uint256",
        indexed: false
      },
      {
        name: "membershipRateLimit",
        internalType: "uint32",
        type: "uint32",
        indexed: false
      },
      { name: "index", internalType: "uint32", type: "uint32", indexed: false }
    ],
    name: "MembershipErased"
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "idCommitment",
        internalType: "uint256",
        type: "uint256",
        indexed: false
      },
      {
        name: "membershipRateLimit",
        internalType: "uint32",
        type: "uint32",
        indexed: false
      },
      { name: "index", internalType: "uint32", type: "uint32", indexed: false }
    ],
    name: "MembershipExpired"
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "idCommitment",
        internalType: "uint256",
        type: "uint256",
        indexed: false
      },
      {
        name: "membershipRateLimit",
        internalType: "uint32",
        type: "uint32",
        indexed: false
      },
      { name: "index", internalType: "uint32", type: "uint32", indexed: false },
      {
        name: "newGracePeriodStartTimestamp",
        internalType: "uint256",
        type: "uint256",
        indexed: false
      }
    ],
    name: "MembershipExtended"
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "idCommitment",
        internalType: "uint256",
        type: "uint256",
        indexed: false
      },
      {
        name: "membershipRateLimit",
        internalType: "uint256",
        type: "uint256",
        indexed: false
      },
      { name: "index", internalType: "uint32", type: "uint32", indexed: false }
    ],
    name: "MembershipRegistered"
  }
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// WakuRlnV2
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const wakuRlnV2Abi = [
  { type: "constructor", inputs: [], stateMutability: "nonpayable" },
  {
    type: "function",
    inputs: [],
    name: "MAX_MEMBERSHIP_SET_SIZE",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "MERKLE_TREE_DEPTH",
    outputs: [{ name: "", internalType: "uint8", type: "uint8" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "Q",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "activeDurationForNewMemberships",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "currentTotalRateLimit",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "deployedBlockNumber",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      { name: "holder", internalType: "address", type: "address" },
      { name: "token", internalType: "address", type: "address" }
    ],
    name: "depositsToWithdraw",
    outputs: [{ name: "balance", internalType: "uint256", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      { name: "idCommitments", internalType: "uint256[]", type: "uint256[]" }
    ],
    name: "eraseMemberships",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [
      { name: "idCommitments", internalType: "uint256[]", type: "uint256[]" },
      { name: "eraseFromMembershipSet", internalType: "bool", type: "bool" }
    ],
    name: "eraseMemberships",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [
      { name: "idCommitments", internalType: "uint256[]", type: "uint256[]" }
    ],
    name: "extendMemberships",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [
      { name: "idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "getMembershipInfo",
    outputs: [
      { name: "", internalType: "uint32", type: "uint32" },
      { name: "", internalType: "uint32", type: "uint32" },
      { name: "", internalType: "uint256", type: "uint256" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [{ name: "index", internalType: "uint40", type: "uint40" }],
    name: "getMerkleProof",
    outputs: [{ name: "", internalType: "uint256[20]", type: "uint256[20]" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      { name: "startIndex", internalType: "uint32", type: "uint32" },
      { name: "endIndex", internalType: "uint32", type: "uint32" }
    ],
    name: "getRateCommitmentsInRangeBoundsInclusive",
    outputs: [{ name: "", internalType: "uint256[]", type: "uint256[]" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "gracePeriodDurationForNewMemberships",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    name: "indicesOfLazilyErasedMemberships",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      { name: "_priceCalculator", internalType: "address", type: "address" },
      { name: "_maxTotalRateLimit", internalType: "uint32", type: "uint32" },
      {
        name: "_minMembershipRateLimit",
        internalType: "uint32",
        type: "uint32"
      },
      {
        name: "_maxMembershipRateLimit",
        internalType: "uint32",
        type: "uint32"
      },
      { name: "_activeDuration", internalType: "uint32", type: "uint32" },
      { name: "_gracePeriod", internalType: "uint32", type: "uint32" }
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [
      { name: "_idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "isExpired",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      { name: "_idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "isInGracePeriod",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      { name: "idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "isInMembershipSet",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      { name: "idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "isValidIdCommitment",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "pure"
  },
  {
    type: "function",
    inputs: [{ name: "rateLimit", internalType: "uint32", type: "uint32" }],
    name: "isValidMembershipRateLimit",
    outputs: [{ name: "", internalType: "bool", type: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "maxMembershipRateLimit",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "maxTotalRateLimit",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      { name: "_idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "membershipExpirationTimestamp",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      { name: "idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "memberships",
    outputs: [
      { name: "depositAmount", internalType: "uint256", type: "uint256" },
      { name: "activeDuration", internalType: "uint32", type: "uint32" },
      {
        name: "gracePeriodStartTimestamp",
        internalType: "uint256",
        type: "uint256"
      },
      { name: "gracePeriodDuration", internalType: "uint32", type: "uint32" },
      { name: "rateLimit", internalType: "uint32", type: "uint32" },
      { name: "index", internalType: "uint32", type: "uint32" },
      { name: "holder", internalType: "address", type: "address" },
      { name: "token", internalType: "address", type: "address" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "merkleTree",
    outputs: [
      { name: "maxIndex", internalType: "uint40", type: "uint40" },
      { name: "numberOfLeaves", internalType: "uint40", type: "uint40" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "minMembershipRateLimit",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "nextFreeIndex",
    outputs: [{ name: "", internalType: "uint32", type: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "priceCalculator",
    outputs: [
      { name: "", internalType: "contract IPriceCalculator", type: "address" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [],
    name: "proxiableUUID",
    outputs: [{ name: "", internalType: "bytes32", type: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      { name: "idCommitment", internalType: "uint256", type: "uint256" },
      { name: "rateLimit", internalType: "uint32", type: "uint32" },
      {
        name: "idCommitmentsToErase",
        internalType: "uint256[]",
        type: "uint256[]"
      }
    ],
    name: "register",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [],
    name: "root",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    inputs: [
      {
        name: "_activeDurationForNewMembership",
        internalType: "uint32",
        type: "uint32"
      }
    ],
    name: "setActiveDuration",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [
      {
        name: "_gracePeriodDurationForNewMembership",
        internalType: "uint32",
        type: "uint32"
      }
    ],
    name: "setGracePeriodDuration",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [
      {
        name: "_maxMembershipRateLimit",
        internalType: "uint32",
        type: "uint32"
      }
    ],
    name: "setMaxMembershipRateLimit",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [
      { name: "_maxTotalRateLimit", internalType: "uint32", type: "uint32" }
    ],
    name: "setMaxTotalRateLimit",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [
      {
        name: "_minMembershipRateLimit",
        internalType: "uint32",
        type: "uint32"
      }
    ],
    name: "setMinMembershipRateLimit",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [
      { name: "_priceCalculator", internalType: "address", type: "address" }
    ],
    name: "setPriceCalculator",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [{ name: "newOwner", internalType: "address", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [
      { name: "newImplementation", internalType: "address", type: "address" }
    ],
    name: "upgradeTo",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    inputs: [
      { name: "newImplementation", internalType: "address", type: "address" },
      { name: "data", internalType: "bytes", type: "bytes" }
    ],
    name: "upgradeToAndCall",
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    inputs: [{ name: "token", internalType: "address", type: "address" }],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousAdmin",
        internalType: "address",
        type: "address",
        indexed: false
      },
      {
        name: "newAdmin",
        internalType: "address",
        type: "address",
        indexed: false
      }
    ],
    name: "AdminChanged"
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "beacon",
        internalType: "address",
        type: "address",
        indexed: true
      }
    ],
    name: "BeaconUpgraded"
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      { name: "version", internalType: "uint8", type: "uint8", indexed: false }
    ],
    name: "Initialized"
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "idCommitment",
        internalType: "uint256",
        type: "uint256",
        indexed: false
      },
      {
        name: "membershipRateLimit",
        internalType: "uint32",
        type: "uint32",
        indexed: false
      },
      { name: "index", internalType: "uint32", type: "uint32", indexed: false }
    ],
    name: "MembershipErased"
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "idCommitment",
        internalType: "uint256",
        type: "uint256",
        indexed: false
      },
      {
        name: "membershipRateLimit",
        internalType: "uint32",
        type: "uint32",
        indexed: false
      },
      { name: "index", internalType: "uint32", type: "uint32", indexed: false }
    ],
    name: "MembershipExpired"
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "idCommitment",
        internalType: "uint256",
        type: "uint256",
        indexed: false
      },
      {
        name: "membershipRateLimit",
        internalType: "uint32",
        type: "uint32",
        indexed: false
      },
      { name: "index", internalType: "uint32", type: "uint32", indexed: false },
      {
        name: "newGracePeriodStartTimestamp",
        internalType: "uint256",
        type: "uint256",
        indexed: false
      }
    ],
    name: "MembershipExtended"
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "idCommitment",
        internalType: "uint256",
        type: "uint256",
        indexed: false
      },
      {
        name: "membershipRateLimit",
        internalType: "uint256",
        type: "uint256",
        indexed: false
      },
      { name: "index", internalType: "uint32", type: "uint32", indexed: false }
    ],
    name: "MembershipRegistered"
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        internalType: "address",
        type: "address",
        indexed: true
      },
      {
        name: "newOwner",
        internalType: "address",
        type: "address",
        indexed: true
      }
    ],
    name: "OwnershipTransferred"
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "implementation",
        internalType: "address",
        type: "address",
        indexed: true
      }
    ],
    name: "Upgraded"
  },
  {
    type: "error",
    inputs: [
      { name: "idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "CannotEraseActiveMembership"
  },
  { type: "error", inputs: [], name: "CannotExceedMaxTotalRateLimit" },
  {
    type: "error",
    inputs: [
      { name: "idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "CannotExtendNonGracePeriodMembership"
  },
  {
    type: "error",
    inputs: [
      { name: "idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "InvalidIdCommitment"
  },
  { type: "error", inputs: [], name: "InvalidMembershipRateLimit" },
  {
    type: "error",
    inputs: [
      { name: "startIndex", internalType: "uint256", type: "uint256" },
      { name: "endIndex", internalType: "uint256", type: "uint256" }
    ],
    name: "InvalidPaginationQuery"
  },
  {
    type: "error",
    inputs: [
      { name: "idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "MembershipDoesNotExist"
  },
  {
    type: "error",
    inputs: [
      { name: "idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "NonHolderCannotEraseGracePeriodMembership"
  },
  {
    type: "error",
    inputs: [
      { name: "idCommitment", internalType: "uint256", type: "uint256" }
    ],
    name: "NonHolderCannotExtend"
  }
] as const;
