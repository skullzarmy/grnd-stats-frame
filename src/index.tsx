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
    fetchQueryWithPagination,
} from "@airstack/frames";
import { devtools } from "frog/dev";
import { serveStatic } from "frog/serve-static";

//
// HELPER FUNCTIONS
//

async function returnSnapshotDate(): Promise<string | null> {
    const latestSnapshotDate = "6/25/24 12:00PST";
    return latestSnapshotDate;
}

function normalizeAddress(address: string): string {
    return address.toLowerCase();
}

// Function to get FID from wallet address using Airstack
async function getFidFromWallet(walletAddress: string): Promise<string | null> {
    const normalizedAddress = normalizeAddress(walletAddress);
    const { data, error } = await fetchQuery(/* GraphQL */ `
        query GetFarcasterUserFromWallet {
            Socials(
                input: {
                    filter: {
                        userAssociatedAddresses: { _eq: "${normalizedAddress}" }
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

// Type definition for the GraphQL response
type TokenBalance = {
    owner: {
        identity: string;
    };
    tokenAddress: string;
    tokenId: string;
    formattedAmount: number;
};

type TokenBalanceResponse = {
    data?: {
        TokenBalances?: {
            TokenBalance?: TokenBalance[] | null;
        } | null;
    } | null;
    error?: any;
};

// Function to check NSO token ownership
async function checkTokenOwnership(fid: string, tokenAddress: string, tokenIds: string[]): Promise<boolean> {
    try {
        // Get all connected wallet addresses for the user
        const userDetails = await getFarcasterUserDetails({ fid });
        const connectedAddresses =
            userDetails?.data?.connectedAddresses.map((addr) => normalizeAddress(addr.address)) || [];

        if (connectedAddresses.length === 0) {
            console.error("No connected addresses found for the user.");
            return false;
        }

        const query = `
            query CheckTokenOwnership($tokenAddress: Address!, $tokenIds: [String!], $owners: [Identity!]) {
                TokenBalances(
                    input: {
                        filter: {
                            tokenAddress: { _eq: $tokenAddress },
                            tokenId: { _in: $tokenIds },
                            owner: { _in: $owners }
                        },
                        blockchain: base,
                        limit: 50
                    }
                ) {
                    TokenBalance {
                        owner {
                            identity
                        }
                        tokenAddress
                        tokenId
                        formattedAmount
                    }
                    pageInfo {
                        nextCursor
                        prevCursor
                    }
                }
            }
        `;

        const variables = {
            tokenAddress,
            tokenIds,
            owners: connectedAddresses,
        };

        // console.log("Query Variables:", variables);

        const response: TokenBalanceResponse = await fetchQuery(query, variables);

        if (response.error) {
            console.error("GraphQL errors:", response.error);
            return false;
        }

        if (!response.data || !response.data.TokenBalances) {
            console.error("Response data or TokenBalances is null or undefined", response);
            return false;
        }

        const tokenBalances = response.data.TokenBalances.TokenBalance;

        if (!tokenBalances || tokenBalances.length === 0) {
            console.error("TokenBalance array is empty or undefined");
            return false;
        }

        // console.log("Token Balances:", tokenBalances);

        return tokenBalances.length > 0;
    } catch (error) {
        console.error("Error checking token ownership:", error);
        return false;
    }
}

// Function to get holder's data from external API
async function getHolderData(walletAddresses: string[]) {
    for (let walletAddress of walletAddresses) {
        walletAddress = normalizeAddress(walletAddress);
        try {
            const url = "https://us-central1-poundprod.cloudfunctions.net/tstgrnd";
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ address: walletAddress }),
            });
            if (response.ok) {
                const data = await response.json();
                if (data.length > 0) {
                    return data[0]; // Return the first valid data found
                }
            }
        } catch (error) {
            console.error(`Error fetching holder data for ${walletAddress}:`, error);
        }
    }
    return null; // Return null if no data found for any address
}

// Helper function to get Farcaster user details by wallet address
async function getUserDetailsByAddress(address: string) {
    const normalizedAddress = normalizeAddress(address);
    const fid = await getFidFromWallet(normalizedAddress);
    if (fid) {
        const userDetails = await getFarcasterUserDetails({ fid });
        const profileImage = userDetails?.data?.profileImage?.extraSmall;
        const profilePictureUrl = profileImage && profileImage.startsWith("http") ? profileImage : null;
        return {
            username: userDetails?.data?.profileName || null,
            profilePictureUrl: profilePictureUrl || null,
        };
    }
    return {
        username: null,
        profilePictureUrl: null,
    };
}

// Function to resolve input to FID
async function resolveInputToFID(inputText: string): Promise<string | null> {
    if (!inputText) return null;

    if (!isNaN(Number(inputText)) && !/^0x[a-fA-F0-9]{40}$/.test(inputText)) {
        return inputText;
    } else if (/^0x[a-fA-F0-9]{40}$/.test(inputText)) {
        const normalizedAddress = normalizeAddress(inputText);
        return await getFidFromWallet(normalizedAddress);
    } else {
        if (inputText.startsWith("@")) {
            inputText = inputText.slice(1);
        }
        return await getFidFromUsername(inputText);
    }
}

// Function to get FID from Farcaster username using Airstack
async function getFidFromUsername(username: string): Promise<string | null> {
    const { data } = await searchFarcasterUsers({ profileName: username });
    if (data && data.length > 0) {
        return data.find((user) => user.profileName === username)?.fid ?? data[0].fid;
    }
    return null;
}

function formatNumber(num: number): string {
    if (num >= 1_000_000_000_000) {
        return (num / 1_000_000_000_000).toFixed(2) + "T";
    } else if (num >= 1_000_000_000) {
        return (num / 1_000_000_000).toFixed(2) + "B";
    } else if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(2) + "M";
    } else if (num >= 1_000) {
        return (num / 1_000).toFixed(2) + "K";
    }
    return num.toLocaleString();
}

// Function to get the top 10 list
async function getTop10List(): Promise<any[]> {
    try {
        const url = "https://us-central1-poundprod.cloudfunctions.net/tstgrnd-top10";
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            return data;
        }
    } catch (error) {
        console.error("Error fetching top 10 list:", error);
    }
    return [];
}

//
// MAIN APP
//

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
    browserLocation: "/browser.html",
});

//
// Cast actions
//
app.castAction(
    "/grnd-stats",
    (c) => {
        const { actionData } = c;
        const { castId } = actionData;
        const fid = castId.fid;
        return c.res({ type: "frame", path: `/stats/${fid}` });
    },
    {
        name: "Check GRND Stats",
        icon: "graph",
    }
);

app.frame("/cast-action", onchainDataMiddleware, async function (c) {
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
                    <div style={{ marginBottom: "20px" }}>GRND Cast Actions</div>
                    <div style={{ marginBottom: "20px" }}>👇 Install Below 👇</div>
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
            <Button.AddCastAction action="/grnd-stats">GRND Stats</Button.AddCastAction>,
            <Button.AddCastAction action="/top-ten-action">Top 10 SNDRs</Button.AddCastAction>,
            <Button.Redirect location="https://warpcast.com/skllzrmy/0x30ecd6ff">Tip Jar</Button.Redirect>,
        ],
        title: "GRND Cast Actions",
    });
});

// New cast action for top 10 frame
app.castAction(
    "/top-ten-action",
    (c) => {
        return c.res({ type: "frame", path: "/top" });
    },
    {
        name: "Top 10 GRND SNDRs",
        icon: "list-ordered",
    }
);

//
// Frames Endpoints
//
app.frame("/", onchainDataMiddleware, async (c) => {
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

app.frame("/stats/:inputText?", onchainDataMiddleware, async (c) => {
    const { inputText, frameData } = c;
    const { castId, fid, messageHash, network, timestamp, url } = frameData;
    const urlParamInputText = c.req.param("inputText");
    let customFID = inputText || urlParamInputText || fid || null;

    if (inputText) {
        customFID = await resolveInputToFID(inputText);
    } else if (urlParamInputText) {
        customFID = await resolveInputToFID(urlParamInputText);
    }

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
                            padding: "5px 20px",
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
                <Button.Redirect location="https://warpcast.com/~/compose?Check%20your%20GRND%20stats%20in%20frame%21%20by%20%40skllzrmy&embeds[]=https://grnd-stats.fly.dev">
                    Share
                </Button.Redirect>,
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
            <Button.Redirect
                location={`https://warpcast.com/~/compose?text=Check%20your%20GRND%20stats%20in%20frame%21%20by%20%40skllzrmy&embeds[]=https://grnd-stats.fly.dev/img/stat/${customFID}&embeds[]=https://grnd-stats.fly.dev/`}
            >
                Share
            </Button.Redirect>,
        ],
        title: "GRND Stats",
    });
});

app.image("/img/stat/:fid", async (c) => {
    const { fid } = c.req.param();
    if (isNaN(parseInt(fid, 10))) {
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
                            padding: "5px 20px",
                            whiteSpace: "pre-wrap",
                            position: "absolute",
                            top: "20%",
                        }}
                    >
                        <div style={{ marginBottom: "5px", fontSize: "6em" }}>🚫</div>
                        <div style={{ marginBottom: "20px", display: "flex" }}>USER '{fid}' NOT FOUND 😢</div>
                        <div style={{ marginBottom: "20px" }}>PLEASE TRY ANOTHER INPUT (FID)</div>
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
                <Button.Redirect location="base:0xa08a01b9a890e9ad5c26f7257e3558d256df8059/2">
                    Get Pass
                </Button.Redirect>,
                <Button.Redirect location={`https://undrgrnd.io/claim`}>Claim</Button.Redirect>,
                <Button.Redirect location="https://warpcast.com/~/compose?Check%20your%20GRND%20stats%20in%20frame%21%20by%20%40skllzrmy&embeds[]=https://grnd-stats.fly.dev">
                    Share
                </Button.Redirect>,
            ],
            title: "UNDRGRND Stats",
        });
    }

    const userDetails = await getFarcasterUserDetails({ fid });
    const connectedAddresses =
        userDetails?.data?.connectedAddresses.map((addr) => normalizeAddress(addr.address)) || [];

    const holderData = await getHolderData(connectedAddresses);
    const grndInput: FarcasterUserERC20BalancesInput = {
        fid: parseInt(fid, 10),
        chains: [TokenBlockchain.Base],
        limit: 100,
    };
    const { data, error }: FarcasterUserERC20BalancesOutput = await getFarcasterUserERC20Balances(grndInput);
    const grndBalance = data
        ?.filter((d) => normalizeAddress(d?.tokenAddress) === "0xd94393cd7fcceb749cd844e89167d4a2cdc64541")
        .reduce((total, current) => total + (current?.amount || 0), 0);

    const tokenAddress = "0xa08a01b9a890e9ad5c26f7257e3558d256df8059";
    const tokenIds = ["1", "2"];
    const ssnPassMinted = await checkTokenOwnership(fid, tokenAddress, tokenIds);
    // console.log("SSN Pass Minted:", ssnPassMinted);
    const profileName = userDetails?.data?.profileName;
    const passHolderColor = ssnPassMinted ? "green" : "red";
    const safeProfileImageUrl = userDetails?.data?.profileImage?.extraSmall ?? null;
    const latestSnapshotDate = await returnSnapshotDate();

    let grndSent = 0;
    let txnCount = 0;
    let currentMultiplier = "1X";
    let percentOfGoal = 0;

    if (holderData) {
        grndSent = holderData.GRND_Sent ?? 0;
        txnCount = holderData.Txn_Count ?? 0;
        percentOfGoal = (grndSent / 15_000_000) * 100;
        if (grndSent >= 15_000_000) {
            currentMultiplier = "10X";
        }
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
                        top: "10px",
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
                                margin: "2px 0",
                                padding: "0px",
                                backgroundColor: "transparent",
                                borderRadius: "8px",
                                width: "100%",
                                textAlign: "left",
                                fontWeight: "800",
                                color: passHolderColor,
                            }}
                        >
                            <strong>Never Sellout Vol.01:</strong> {ssnPassMinted ? "HODLR 💎🤲" : "👎🚫😢"}
                        </div>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                margin: "2px 0",
                                padding: "0px",
                                backgroundColor: "transparent",
                                borderRadius: "8px",
                                width: "100%",
                                textAlign: "left",
                                fontWeight: "800",
                                color: "white",
                            }}
                        >
                            <strong>GRND Sent:</strong>{" "}
                            {grndSent ? formatNumber(parseInt(grndSent, 10)) : ssnPassMinted ? "0" : "🚫"}
                        </div>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                margin: "2px 0",
                                padding: "0px",
                                backgroundColor: "transparent",
                                borderRadius: "8px",
                                width: "100%",
                                textAlign: "left",
                                fontWeight: "800",
                                color: "white",
                            }}
                        >
                            <strong>Txns Counted:</strong>{" "}
                            {txnCount ? formatNumber(txnCount) : ssnPassMinted ? "0" : "🚫"}
                        </div>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                margin: "2px 0",
                                padding: "0px",
                                backgroundColor: "transparent",
                                borderRadius: "8px",
                                width: "100%",
                                textAlign: "left",
                                fontWeight: "800",
                                color: "white",
                            }}
                        >
                            <strong>Refund Multiplier:</strong>
                            <span
                                style={{
                                    fontSize: "1em",
                                    fontWeight: "bold",
                                    align: "text-baseline",
                                    color: grndSent >= 15_000_000 ? "green" : "white",
                                }}
                            >
                                {ssnPassMinted ? currentMultiplier : "🚫"}
                            </span>
                        </div>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                margin: "2px 0",
                                padding: "0px",
                                backgroundColor: "transparent",
                                borderRadius: "8px",
                                width: "100%",
                                textAlign: "left",
                                fontWeight: "800",
                                color: "white",
                            }}
                        >
                            <strong>July Refund:</strong>
                            <span
                                style={{
                                    fontSize: "1em",
                                    fontWeight: "bold",
                                    align: "text-baseline",
                                    color: grndSent >= 15_000_000 ? "green" : "white",
                                }}
                            >
                                {ssnPassMinted
                                    ? grndSent >= 15_000_000
                                        ? "150M (max)"
                                        : formatNumber(grndSent)
                                    : "🚫"}
                            </span>
                        </div>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                margin: "2px 0",
                                padding: "0px",
                                backgroundColor: "transparent",
                                borderRadius: "8px",
                                width: "100%",
                                textAlign: "left",
                                fontWeight: "800",
                                color: "white",
                            }}
                        >
                            <strong>% of Goal:</strong>
                            <span
                                style={{
                                    fontSize: "1em",
                                    fontWeight: "bold",
                                    align: "text-baseline",
                                    color: grndSent >= 15_000_000 ? "green" : "white",
                                }}
                            >
                                {ssnPassMinted ? percentOfGoal.toFixed(2) + "%" : "🚫"}
                            </span>
                        </div>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                margin: "15px 0",
                                padding: "10px",
                                backgroundColor: "#00000066",
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
                        position: "absolute",
                        display: "flex",
                        bottom: "8px",
                        left: "300px",
                        color: "white",
                        fontSize: "0.8em",
                    }}
                >
                    Snapshot: {latestSnapshotDate}
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
                <div
                    class="footer"
                    style={{
                        position: "absolute",
                        display: "flex",
                        bottom: "8px",
                        right: "300px",
                        color: "white",
                        fontSize: "0.8em",
                    }}
                >
                    snapshot updated every ~48hrs
                </div>
            </div>
        ),
        headers: {
            "Cache-Control": "max-age=0",
        },
    });
});

// New frame endpoint for top 10
app.frame("/top", onchainDataMiddleware, async (c) => {
    return c.res({
        action: "/top",
        image: "/img/top",
        intents: [
            <Button.Redirect location="https://warpcast.com/~/compose?embeds[]=https://grnd-stats.fly.dev/top">
                Share
            </Button.Redirect>,
        ],
        title: "Top 10 List",
    });
});

// Image endpoint for top 10
app.image("/img/top", async (c) => {
    const top10List = await getTop10List();
    const latestSnapshotDate = await returnSnapshotDate();

    // Get additional details for each entry
    const top10Details = await Promise.all(
        top10List.map(async (item) => {
            const userDetails = await getUserDetailsByAddress(item.address);
            return {
                ...item,
                ...userDetails,
            };
        })
    );

    return c.res({
        image: (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    background: "black",
                    height: "100%",
                    justifyContent: "center",
                    textAlign: "center",
                    width: "100%",
                    padding: "20px",
                    borderRadius: "15px",
                    boxShadow: "0 4px 8px rgba(0, 0, 0, 0.1)",
                    position: "relative",
                }}
            >
                <img
                    src="https://grnd-stats.fly.dev/logo.png"
                    alt="UNDRGRND logo"
                    style={{
                        position: "absolute",
                        top: "0",
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        opacity: 0.1,
                    }}
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
                        marginTop: "0px",
                        padding: "0",
                        whiteSpace: "pre-wrap",
                        position: "absolute",
                        top: "5%",
                    }}
                >
                    <div style={{ marginBottom: "40px", fontSize: "1.9em" }}>GRND SNDR TOP 10</div>
                </div>
                <div
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        justifyContent: "center",
                        gap: "5px",
                        alignItems: "center",
                        color: "white",
                        fontSize: "0.9em", // Smaller font size
                        fontStyle: "normal",
                        letterSpacing: "-0.025em",
                        lineHeight: 1.4,
                        marginTop: "10%",
                        padding: "2%",
                        whiteSpace: "pre-wrap",
                        width: "60%",
                    }}
                >
                    {top10Details.map((item, index) => (
                        <div
                            key={index}
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                width: "30%", // Adjusted width to fit better
                                padding: "0.5% 1.5%", // Adjusted padding to fit better
                                margin: "0px auto",
                                textAlign: "center",
                                borderBottom: "2px dashed white",
                            }}
                        >
                            <span
                                style={{
                                    fontSize: "1.8em",
                                    fontWeight: "bold",
                                    marginBottom: "10px",
                                    paddingRight: "10px",
                                    textAlign: "left",
                                }}
                            >
                                {index + 1}
                            </span>{" "}
                            {/* Slightly smaller font size */}
                            {item.profilePictureUrl ? (
                                <img
                                    src={item.profilePictureUrl}
                                    alt={`${item.username || item.address.slice(0, 5)}...${item.address.slice(-5)}`}
                                    style={{
                                        borderRadius: "50%",
                                        width: "40px", // Smaller image size
                                        height: "40px",
                                        marginBottom: "10px",
                                        align: "text-middle",
                                        marginRight: "5px",
                                    }}
                                />
                            ) : (
                                <div
                                    style={{
                                        width: "40px", // Smaller placeholder size
                                        height: "40px",
                                        borderRadius: "50%",
                                        backgroundColor: "gray",
                                        marginBottom: "10px",
                                        align: "text-middle",
                                        marginRight: "5px",
                                    }}
                                />
                            )}
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                                <span style={{ fontSize: "1.25em", fontWeight: "800" }}>
                                    {item.username || `${item.address.slice(0, 5)}...${item.address.slice(-5)}`}
                                </span>
                                <span style={{ fontSize: "1.25em" }}>{formatNumber(item.GRND_Sent)}</span>{" "}
                                {/* Smaller font size */}
                            </div>
                        </div>
                    ))}
                </div>
                <div
                    class="footer"
                    style={{
                        position: "absolute",
                        display: "flex",
                        bottom: "8px",
                        left: "300px",
                        color: "white",
                        fontSize: "0.8em",
                    }}
                >
                    Snapshot: {latestSnapshotDate}
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
                        position: "absolute",
                        bottom: "-25px",
                    }}
                >
                    <img
                        src="https://grnd-stats.fly.dev/skllzrmy.png"
                        alt="skllzrmys logo"
                        style={{ width: "150px", display: "flex" }}
                    />
                </div>
                <div
                    class="footer"
                    style={{
                        position: "absolute",
                        display: "flex",
                        bottom: "8px",
                        right: "300px",
                        color: "white",
                        fontSize: "0.8em",
                    }}
                >
                    snapshot updated every ~48hrs
                </div>
            </div>
        ),
        headers: {
            "Cache-Control": "max-age=1800",
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
