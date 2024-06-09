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
    fetchQuery,
} from "@airstack/frames";
import { devtools } from "frog/dev";
import { serveStatic } from "frog/serve-static";

// Function to get FID from wallet address using Airstack
async function getFidFromWallet(walletAddress: string): Promise<string | null> {
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
                    userId
                }
            }
        }
    `);

    if (error) throw new Error(error);

    return data?.Socials?.Social[0]?.userId ?? null;
}

// Function to get FID from Farcaster username using Airstack
async function getFidFromUsername(username: string): Promise<string | null> {
    const { data } = await searchFarcasterUsers({ profileName: username });
    if (data && data.length > 0) {
        return data.find((user) => user.profileName === username)?.fid ?? data[0].fid;
    }
    return null;
}

// Function to resolve input to FID
async function resolveInputToFID(inputText: string): Promise<string | null> {
    if (!inputText) return null;

    if (!isNaN(Number(inputText)) && !/^0x[a-fA-F0-9]{40}$/.test(inputText)) {
        return inputText;
    } else if (/^0x[a-fA-F0-9]{40}$/.test(inputText)) {
        return await getFidFromWallet(inputText);
    } else {
        return await getFidFromUsername(inputText);
    }
}

function formatNumber(num: number): string {
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

async function getTokenTransfers(fromAddress: string, toAddress: string): Promise<any> {
    const query = `
        query GetTransactions {
            Base: TokenTransfers(
                input: {
                    filter: {
                        from: { _eq: "${fromAddress}" },
                        to: { _eq: "${toAddress}" }
                    },
                    blockchain: base,
                    limit: 50
                }
            ) {
                TokenTransfer {
                    id
                    from {
                        identity
                    }
                    to {
                        identity
                    }
                    type
                    tokenAddress
                    amount
                    formattedAmount
                }
            }
        }
    `;
    try {
        // console.log("Fetching token transfers...");
        // console.log("Query:", query);
        const { data, error } = await fetchQuery(query);
        if (error) throw new Error(JSON.stringify(error));

        return data.Base.TokenTransfer;
    } catch (err) {
        console.error("Error fetching token transfers:", err);
        throw err;
    }
}

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
    browserLocation: "/browser.html",
});

// Cast actions
app.castAction(
    "/grnd-stats",
    (c) => {
        return c.res({ type: "frame", path: "/stats" });
    },
    {
        name: "Check GRND Stats",
        icon: "graph",
    }
);

app.frame("/cast-action", async function (c) {
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
                <div
                    class="footer"
                    style={{
                        display: "flex",
                        backgroundColor: "white",
                        padding: "10px",
                        margin: "15px auto",
                        borderRadius: "15px",
                        border: "2px dashed #000",
                    }}
                >
                    <img
                        src="https://grnd-stats.fly.dev/skllzrmy.png"
                        alt="skllzrmys logo"
                        style={{ width: "150px", display: "flex" }}
                    />
                </div>
            </div>
        ),
        intents: [
            <TextInput placeholder="FID, username, wallet, or ENS." />,
            <Button>🔎</Button>,
            <Button.AddCastAction action="/grnd-stats">Install GRND Stats</Button.AddCastAction>,
            <Button.Redirect location="https://warpcast.com/skllzrmy/0x30ecd6ff">Tip</Button.Redirect>,
        ],
        title: "UNDRGRND Stats",
    });
});

app.frame("/", onchainDataMiddleware, async function (c) {
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
                <div
                    class="footer"
                    style={{
                        display: "flex",
                        backgroundColor: "white",
                        padding: "10px",
                        margin: "15px auto",
                        borderRadius: "15px",
                        border: "2px dashed #000",
                    }}
                >
                    <img
                        src="https://grnd-stats.fly.dev/skllzrmy.png"
                        alt="skllzrmys logo"
                        style={{ width: "150px", display: "flex" }}
                    />
                </div>
            </div>
        ),
        intents: [
            <TextInput placeholder="FID, username, wallet, or ENS." />,
            <Button>🔎</Button>,
            <Button.Redirect location="https://warpcast.com/skllzrmy/0x30ecd6ff">Tip</Button.Redirect>,
        ],
        title: "UNDRGRND Stats",
    });
});

app.frame("/stats/:inputText?", onchainDataMiddleware, async function (c) {
    const { inputText } = c;
    const urlParamInputText = c.req.param("inputText");
    let customFID = "1";

    if (inputText) {
        customFID = await resolveInputToFID(inputText);
    } else if (urlParamInputText) {
        customFID = await resolveInputToFID(urlParamInputText);
    } else {
        customFID = await resolveInputToFID(c.var.userDetails?.profileName);
    }

    const currentClaimAddress = "0x0d330286b454f1e1bc731e083a78b2957b8f0ea2";

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
                            USER {inputText ? `'${inputText}'` : urlParamInputText ? `'${urlParamInputText}'` : ""} NOT
                            FOUND 😢
                        </div>
                        <div style={{ marginBottom: "20px" }}>PLEASE TRY ANOTHER INPUT</div>
                    </div>
                    <div
                        class="footer"
                        style={{
                            display: "flex",
                            backgroundColor: "white",
                            padding: "10px",
                            margin: "15px auto",
                            borderRadius: "15px",
                            border: "2px dashed #000",
                        }}
                    >
                        <img
                            src="https://grnd-stats.fly.dev/skllzrmy.png"
                            alt="skllzrmys logo"
                            style={{ width: "150px", display: "flex" }}
                        />
                    </div>
                </div>
            ),
            intents: [
                <TextInput placeholder="FID, username, wallet, or ENS." />,
                <Button>🔎</Button>,
                <Button.Redirect location="https://zora.co/collect/base:0xa08a01b9a890e9ad5c26f7257e3558d256df8059/2">
                    Get Pass
                </Button.Redirect>,
                <Button.Redirect location={`https://undrgrnd.io/claim`}>Claim</Button.Redirect>,
                <Button.Redirect location="https://warpcast.com/skllzrmy/0xd55fe1b1">Tip Jar</Button.Redirect>,
            ],
            title: "UNDRGRND Stats",
        });
    }

    return c.res({
        image: `/img/stat/${customFID}`,
        intents: [
            <TextInput placeholder="FID, username, wallet, or ENS." />,
            <Button>🔎</Button>,
            <Button.Redirect location="https://zora.co/collect/base:0xa08a01b9a890e9ad5c26f7257e3558d256df8059/2">
                Get Pass
            </Button.Redirect>,
            <Button.Redirect location={`https://undrgrnd.io/claim`}>Claim</Button.Redirect>,
            <Button.Redirect location="https://warpcast.com/skllzrmy/0xd55fe1b1">Tip Jar</Button.Redirect>,
        ],
        title: "UNDRGRND Stats",
    });
});

app.image("/img/stat/:fid", async (c) => {
    const { fid } = c.req.param();
    const userDetails = await getFarcasterUserDetails({ fid });
    const grndInput: FarcasterUserERC20BalancesInput = {
        fid: parseInt(fid, 10),
        chains: [TokenBlockchain.Base],
        limit: 100,
    };
    const { data, error }: FarcasterUserERC20BalancesOutput = await getFarcasterUserERC20Balances(grndInput);
    const grndBalance = data
        ?.filter((d) => d?.tokenAddress === "0xd94393cd7fcceb749cd844e89167d4a2cdc64541")
        .reduce((total, current) => total + (current?.amount || 0), 0);

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
    const passHolderColor = ssnPass1Minted.data[0]?.isHold ? "green" : "red";
    const safeProfileImageUrl = userDetails?.data?.profileImage?.extraSmall ?? null;
    let claims = [];
    let unclaimed = [];
    let claimed = [];

    if (ssnPass1Minted.data[0]?.isHold) {
        // loop userDetails.data?.connectedAddresses and get all claims for all addresses
        for (let i = 0; i < userDetails.data?.connectedAddresses.length; i++) {
            // console.log("Getting claims for address:", userDetails.data?.connectedAddresses[i].address);
            const addressClaims = await getTokenTransfers(
                "0x20bc4c4f593067d298fdcc14a60fef5dfc93fd8e",
                userDetails.data?.connectedAddresses[i].address
            );
            if (addressClaims) {
                claims = claims.concat(addressClaims);
            }
        }

        // console.log("Claims:", claims);
        const userClaims = (claims || []).map((claim) => ({
            address: claim.to.identity,
            timestamp: claim.blockTimestamp,
        }));

        unclaimed = userClaims.filter((claim) => claim.address === fid);
        claimed = userClaims.filter((claim) => claim.address !== fid);
    }

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
                <div
                    class="footer"
                    style={{
                        display: "flex",
                        backgroundColor: "white",
                        padding: "10px",
                        margin: "15px auto",
                        borderRadius: "15px",
                        border: "2px dashed #000",
                    }}
                >
                    <img
                        src="https://grnd-stats.fly.dev/skllzrmy.png"
                        alt="skllzrmys logo"
                        style={{ width: "150px", display: "flex" }}
                    />
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
