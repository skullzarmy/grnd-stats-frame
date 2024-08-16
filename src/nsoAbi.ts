export const nsoABI = [
    {
        inputs: [
            { internalType: "address", name: "receiver", type: "address" },
            { internalType: "uint256", name: "quantity", type: "uint256" },
            { internalType: "address", name: "currency", type: "address" },
            { internalType: "uint256", name: "pricePerToken", type: "uint256" },
            { internalType: "bytes", name: "data", type: "bytes" },
        ],
        name: "claim",
        outputs: [],
        stateMutability: "payable",
        type: "function",
    },
] as const;

export const erc20ABI = [
    {
        inputs: [
            { internalType: "address", name: "spender", type: "address" },
            { internalType: "uint256", name: "amount", type: "uint256" },
        ],
        name: "approve",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function",
    },
] as const;
