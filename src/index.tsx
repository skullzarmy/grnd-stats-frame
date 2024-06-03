import { Button, Frog, TextInput } from "@airstack/frog";
import {
    onchainDataFrogMiddleware as onchainData,
    TokenBlockchain,
    getFarcasterUserERC20Balances,
    FarcasterUserERC20BalancesInput,
    FarcasterUserERC20BalancesOutput,
    checkTokenHoldByFarcasterUser,
    getFarcasterUserDetails,
    searchFarcasterUsers,
    SearchFarcasterUsersInput,
    SearchFarcastersOutput,
    fetchQuery,
} from "@airstack/frames";
import { devtools } from "frog/dev";
import { serveStatic } from "frog/serve-static";

// Function to get FID from wallet address using Airstack
async function getFidFromWallet(walletAddress: string) {
    const { data, error } = await fetchQuery(/* GraphQL */ `
        query GetFarcasterUserFromWallet {
            Socials(
                input: {
                    filter: {
                        userAssociatedAddresses: { _eq: "${walletAddress}" }
                        dappName: { _eq: farcaster }
                    }
                    blockchain: ethereum
                }
            ) {
                Social {
                    dappName
                    profileName
                    userId
                    connectedAddresses {
                        address
                        blockchain
                    }
                }
            }
        }
    `);

    if (error) throw new Error(error);

    return data.Socials.Social[0].userId;
}

// Function to get FID from Farcaster username using Airstack
async function getFidFromUsername(username: string) {
    const { data } = await searchFarcasterUsers({ profileName: username });
    // if return is empty, return null, else search for exact string match and return fid, else return top result
    let dreturn = null;
    if (data && data.length > 0) {
        for (let i = 0; i < data.length; i++) {
            if (data[i]?.profileName === username) {
                dreturn = data[i]?.fid;
                break;
            }
        }
        if (dreturn === null) {
            dreturn = data[0]?.fid;
        }
    }
    // const dreturn = data && data.length > 0 ? data[0].fid : null;
    return dreturn;
}

// Function to resolve input to FID
async function resolveInputToFID(inputText) {
    let fid;
    if (!inputText) {
        return null;
    }

    // Check if the inputText is a number
    if (!isNaN(inputText) && !/^0x[a-fA-F0-9]{40}$/.test(inputText)) {
        // console.log("Input is a number");
        fid = inputText;
        // console.log("FID from number: ", fid);
    } else {
        const isWalletAddress = /^0x[a-fA-F0-9]{40}$/.test(inputText);

        if (isWalletAddress) {
            // console.log("Wallet address detected");
            fid = await getFidFromWallet(inputText);
            // console.log("FID from wallet address: ", fid);
        } else {
            // console.log("Not a wallet address, checking for username");
            fid = await getFidFromUsername(inputText);
            // console.log("FID from username: ", fid);
        }
    }

    return fid;
}

function formatNumber(num) {
    if (num >= 1_000_000_000_000) {
        return (num / 1_000_000_000_000).toFixed(1) + "T";
    } else if (num >= 1_000_000_000) {
        return (num / 1_000_000_000).toFixed(1) + "B";
    } else if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(1) + "M";
    } else if (num >= 1_000) {
        return (num / 1_000).toFixed(1) + "K";
    }
    return num.toLocaleString();
}

const onchainDataMiddleware = onchainData({
    env: "dev",
    features: {
        userDetails: {},
        erc20Balances: {
            chains: [TokenBlockchain.Base],
            limit: 100,
        },
    },
});

export const app = new Frog({
    apiKey: process.env.AIRSTACK_API_KEY as string,
    imageAspectRatio: "1:1",
    hub: {
        apiUrl: "https://hubs.airstack.xyz",
        fetchOptions: {
            headers: {
                "x-airstack-hubs": process.env.AIRSTACK_API_KEY as string,
            },
        },
    },
});

app.frame("/", onchainDataMiddleware, async function (c) {
    const { buttonValue, inputText, status } = c;
    return c.res({
        action: "/stats",
        image: (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    background: "black",
                    backgroundSize: "100% 100%",
                    height: "100%",
                    justifyContent: "center",
                    textAlign: "center",
                    width: "100%",
                    padding: "20px",
                    borderRadius: "15px",
                    boxShadow: "0 4px 8px rgba(0, 0, 0, 0.1)",
                }}
            >
                <img
                    src="https://grnd-stats.fly.dev/logo.png"
                    alt="UNDRGRND logo"
                    style={{ width: "100%", height: "100%", objectFit: "contain", opacity: 0.5 }}
                />
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        color: "white",
                        fontSize: "1.5em",
                        fontStyle: "normal",
                        letterSpacing: "-0.025em",
                        lineHeight: 1.4,
                        marginTop: "20px",
                        padding: "0",
                        whiteSpace: "pre-wrap",
                        position: "absolute",
                        top: "40%",
                    }}
                >
                    <div style={{ marginBottom: "20px" }}>Welcome to UNDRGRND!</div>
                    <div style={{ marginBottom: "20px" }}>Check your stats below 👇</div>
                </div>
            </div>
        ),
        intents: [
            <TextInput placeholder={`FID, username, wallet, or ENS.`} />,
            <Button>🔎</Button>,
            <Button.Reset>Reset</Button.Reset>,
            <Button.Redirect location="https://zora.co/collect/base:0xa08a01b9a890e9ad5c26f7257e3558d256df8059/2">
                Mint Pass
            </Button.Redirect>,
        ],
        title: "UNDRGRND Stats",
    });
});

app.frame("/stats/:inputText?", onchainDataMiddleware, async function (c) {
    const { buttonValue, inputText, status } = c;
    const urlParamInputText = c.req.param("inputText");
    let customFID = "1";

    if (inputText) {
        customFID = await resolveInputToFID(inputText);
    } else if (urlParamInputText) {
        customFID = await resolveInputToFID(urlParamInputText);
    } else {
        customFID = await resolveInputToFID(c.var.userDetails?.profileName);
    }

    // claim data
    const claimData = await fetchQuery(/* GraphQL */ `
        query GetTokenTransfers {
            Base: TokenTransfers(
                input: {
                    filter: {
                        from: { _eq: "0x20bc4c4f593067d298fdcc14a60fef5dfc93fd8e" }
                        tokenAddress: { _eq: "0xd94393cd7fcceb749cd844e89167d4a2cdc64541" }
                        type: { _eq: TRANSFER }
                        formattedAmount: { _gt: 1000000000 }
                        blockTimestamp: { _gte: "2024-06-01T13:53:17Z" }
                    }
                    blockchain: base
                    limit: 200
                    order: { blockTimestamp: ASC }
                }
            ) {
                TokenTransfer {
                    to {
                        identity
                    }
                    blockTimestamp
                }
            }
        }
    `);
    const claimsArray = claimData.data.Base.TokenTransfer.map((claim) => {
        return {
            address: claim.to.identity,
            timestamp: claim.blockTimestamp,
        };
    });
    const currentClaimAddress = claimsArray[0].address;

    if (!customFID) {
        return c.res({
            action: "/stats",
            image: (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        background: "black",
                        backgroundSize: "100% 100%",
                        height: "100%",
                        justifyContent: "center",
                        textAlign: "center",
                        width: "100%",
                        padding: "20px",
                        borderRadius: "15px",
                        boxShadow: "0 4px 8px rgba(0, 0, 0, 0.1)",
                    }}
                >
                    <img
                        src="https://grnd-stats.fly.dev/logo.png"
                        alt="UNDRGRND logo"
                        style={{ width: "100%", height: "100%", objectFit: "contain", opacity: 0.5 }}
                    />
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            color: "#FF2222",
                            backgroundColor: "rgba(0, 0, 0, 0.75)",
                            borderRadius: "15px",
                            border: "5px dashed #AA0000",
                            fontWeight: "bold",
                            fontSize: "1.5em",
                            fontStyle: "normal",
                            letterSpacing: "-0.025em",
                            lineHeight: 1.4,
                            marginTop: "20px",
                            padding: "10px",
                            whiteSpace: "pre-wrap",
                            position: "absolute",
                            top: "20%",
                        }}
                    >
                        <div style={{ marginBottom: "5px", fontSize: "6em" }}>🚫</div>
                        <div style={{ marginBottom: "20px", display: "flex" }}>
                            USER{" "}
                            {inputText ? "'" + inputText + "'" : urlParamInputText ? "'" + urlParamInputText + "'" : ""}{" "}
                            NOT FOUND 😢
                        </div>
                        <div style={{ marginBottom: "20px" }}>PLEASE TRY ANOTHER INPUT</div>
                    </div>
                </div>
            ),
            intents: [
                <TextInput placeholder={`FID, username, wallet, or ENS.`} />,
                <Button>🔎</Button>,
                // <Button.Reset>Reset</Button.Reset>,
                <Button.Redirect location="https://zora.co/collect/base:0xa08a01b9a890e9ad5c26f7257e3558d256df8059/2">
                    Get Pass
                </Button.Redirect>,
                <Button.Redirect location={`https://app.stationx.network/claim/${currentClaimAddress}/0x2105`}>
                    Claim
                </Button.Redirect>,
                <Button.Redirect location="https://warpcast.com/skllzrmy/0x30ecd6ff">Tip Jar</Button.Redirect>,
            ],
            title: "UNDRGRND Stats",
        });
    }

    return c.res({
        image: `/img/stat/${customFID}`,
        intents: [
            <TextInput placeholder={`FID, username, wallet, or ENS.`} />,
            <Button>🔎</Button>,
            // <Button.Reset>Reset</Button.Reset>,
            <Button.Redirect location="https://zora.co/collect/base:0xa08a01b9a890e9ad5c26f7257e3558d256df8059/2">
                Get Pass
            </Button.Redirect>,
            <Button.Redirect location={`https://app.stationx.network/claim/${currentClaimAddress}/0x2105`}>
                Claim
            </Button.Redirect>,
            <Button.Redirect location="https://warpcast.com/skllzrmy/0x30ecd6ff">Tip Jar</Button.Redirect>,
        ],
        title: "UNDRGRND Stats",
    });
});

app.image("/img/stat/:fid", async (c) => {
    const { fid } = c.req.param();
    const userDetails = await getFarcasterUserDetails({ fid: fid });
    const grndInput: FarcasterUserERC20BalancesInput = {
        fid: parseInt(fid, 10),
        chains: [TokenBlockchain.Base],
        limit: 100,
    };
    const { data, error, hasNextPage, hasPrevPage, getNextPage, getPrevPage }: FarcasterUserERC20BalancesOutput =
        await getFarcasterUserERC20Balances(grndInput);
    const grndBalance = data
        ?.filter((d) => d?.tokenAddress === "0xd94393cd7fcceb749cd844e89167d4a2cdc64541")
        .reduce((total, current) => total + (current?.amount || 0), 0);
    // console.log("GRND Balance", grndBalance);
    const ssnPass1Minted = await checkTokenHoldByFarcasterUser({
        fid: parseInt(fid, 10),
        token: [
            {
                chain: TokenBlockchain.Base,
                tokenAddress: "0xa08a01b9a890e9ad5c26f7257e3558d256df8059",
            },
        ],
    });
    const profileName = userDetails?.data?.profileName;
    const passHolderColor = ssnPass1Minted.data[0].isHold ? "green" : "red";
    const safeProfileImageUrl = userDetails?.data?.profileImage?.extraSmall
        ? userDetails.data.profileImage.extraSmall
        : null;

    // claim data
    const claimData = await fetchQuery(/* GraphQL */ `
        query GetTokenTransfers {
            Base: TokenTransfers(
                input: {
                    filter: {
                        from: { _eq: "0x20bc4c4f593067d298fdcc14a60fef5dfc93fd8e" }
                        tokenAddress: { _eq: "0xd94393cd7fcceb749cd844e89167d4a2cdc64541" }
                        type: { _eq: TRANSFER }
                        formattedAmount: { _gt: 1000000000 }
                        blockTimestamp: { _gte: "2024-06-01T13:53:17Z" }
                    }
                    blockchain: base
                    limit: 200
                    order: { blockTimestamp: ASC }
                }
            ) {
                TokenTransfer {
                    to {
                        identity
                    }
                    blockTimestamp
                }
            }
        }
    `);
    const claimsArray = claimData.data.Base.TokenTransfer.map((claim) => {
        return {
            address: claim.to.identity,
            timestamp: claim.blockTimestamp,
        };
    });
    const currentClaimAddress = claimsArray[0].address;
    // loop through claimsArray and use fetchquery to see if the user has interacted with the contract
    let userClaims = [];
    for (let i = 0; i < claimsArray.length; i++) {
        const claim = claimsArray[i];
        const claimUser = await getFarcasterUserDetails({ fid: claim.address });
        userClaims.push({
            address: claim.address,
            timestamp: claim.timestamp,
        });
    }
    const unclaimed = userClaims.filter((claim) => claim.address === fid);
    const claimed = userClaims.filter((claim) => claim.address !== fid);

    return c.res({
        image: (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    background: "black",
                    backgroundSize: "100% 100%",
                    height: "100%",
                    justifyContent: "center",
                    textAlign: "center",
                    width: "100%",
                    padding: "20px",
                    borderRadius: "15px",
                    boxShadow: "0 4px 8px rgba(0, 0, 0, 0.1)",
                }}
            >
                <img
                    src="https://grnd-stats.fly.dev/logo.png"
                    alt="UNDRGRND logo"
                    style={{ width: "100%", height: "100%", objectFit: "contain", opacity: 0.1 }}
                />
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        color: "white",
                        fontSize: "1.5em",
                        fontStyle: "normal",
                        letterSpacing: "-0.025em",
                        lineHeight: 1.4,
                        top: "15px",
                        padding: "0",
                        whiteSpace: "pre-wrap",
                        position: "absolute",
                    }}
                >
                    <div style={{ marginBottom: "5px", display: "flex", alignItems: "center" }}>
                        {safeProfileImageUrl && (
                            <img
                                src={safeProfileImageUrl}
                                alt={`${profileName}'s profile`}
                                style={{ borderRadius: "50%", width: "50px", height: "50px", marginRight: "10px" }}
                            />
                        )}
                        <h2>{`@${profileName}`}</h2>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                margin: "10px 0",
                                padding: "10px",
                                backgroundColor: "transparent",
                                borderRadius: "8px",
                                width: "100%",
                                textAlign: "left",
                                fontWeight: "800",
                                color: passHolderColor,
                            }}
                        >
                            <strong>Never Sellout Vol.01:</strong>{" "}
                            {ssnPass1Minted?.data[0]?.isHold ? "HODLR 💎🤲" : "👎🚫😢"}
                        </div>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                margin: "5px 0",
                                padding: "10px",
                                backgroundColor: "transparent",
                                borderRadius: "8px",
                                width: "100%",
                                textAlign: "left",
                            }}
                        >
                            <strong>Unclaimed:</strong>{" "}
                            {ssnPass1Minted?.data[0]?.isHold
                                ? formatNumber(500000 * unclaimed.length) + " $GRND"
                                : "🚫"}
                        </div>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                margin: "5px 0",
                                padding: "10px",
                                backgroundColor: "transparent",
                                borderRadius: "8px",
                                width: "100%",
                                textAlign: "left",
                            }}
                        >
                            <strong>Claimed:</strong>{" "}
                            {ssnPass1Minted?.data[0]?.isHold ? formatNumber(500000 * claimed.length) + " $GRND" : "🚫"}
                        </div>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                margin: "10px 0",
                                padding: "10px",
                                backgroundColor: "transparent",
                                borderRadius: "8px",
                                border: "2px dashed #fff",
                                width: "100%",
                                textAlign: "left",
                            }}
                        >
                            <strong>$GRND Balance:</strong> {grndBalance ? grndBalance.toLocaleString() : "0"}
                        </div>
                    </div>
                </div>
            </div>
        ),
        headers: {
            "Cache-Control": "max-age=0",
        },
    });
});

app.use("/*", serveStatic({ root: "./public" }));
devtools(app, { serveStatic });

if (typeof Bun !== "undefined") {
    Bun.serve({
        fetch: app.fetch,
        port: 3000,
    });
    console.log("Server is running on port 3000");
}
