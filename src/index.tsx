import { Button, Frog, TextInput, TokenBlockchain } from "@airstack/frog";
import { onchainDataFrogMiddleware as onchainData, fetchQuery } from "@airstack/frames";
import { devtools } from "frog/dev";
import { serveStatic } from "frog/serve-static";
import { parse } from "dotenv";
import { DuneClient } from "@duneanalytics/client-sdk";
import Fuse from "fuse.js";
const DEBUG = process.env.DEBUG === "true";
conLog("Debug mode:", DEBUG);
const onchainDataMiddleware = onchainData({
    env: "dev",
    features: {
        userDetails: {},
    },
});

const CURRENT_USER = process.env.CURRENT_USER;
if (!CURRENT_USER) {
    conErr("Current user is missing.");
}
const DUNE_API_KEY = process.env[`DUNE_API_KEY_${CURRENT_USER?.toUpperCase() ?? ""}`];
const DUNE_QUERY_ID = process.env[`DUNE_QUERY_ID_${CURRENT_USER?.toUpperCase() ?? ""}`];
if (!DUNE_API_KEY || !DUNE_QUERY_ID) {
    conErr("Dune API key or query ID is missing.");
}
const duneClient = new DuneClient(DUNE_API_KEY ?? "");

type NSOPassHolder = {
    fid: string;
    fname: string;
    verified_addresses: string[];
    total_grnd_spent: number;
};

function conLog(...args: any[]) {
    if (DEBUG) {
        console.log(...args);
    }
}

function conErr(...args: any[]) {
    if (DEBUG) {
        console.error(...args);
    }
}

// Fetch all NSO pass holder data from Dune
async function fetchNSOPassHolders(): Promise<NSOPassHolder[]> {
    try {
        const queryResult = await duneClient.getLatestResult({ queryId: parseInt(DUNE_QUERY_ID ?? "") });
        if (!queryResult || !queryResult.result) {
            conErr("Query result is missing or invalid");
            return [];
        }

        return queryResult.result.rows.map((row: any) => ({
            fid: row.fid,
            fname: row.fname,
            verified_addresses: row.verified_addresses,
            total_grnd_spent: row.total_grnd_spent,
        }));
    } catch (error) {
        conErr("Error fetching NSO pass holders:", error);
        return [];
    }
}

async function fetchGRNDBalance(wallets: string[] | string): Promise<number> {
    if (!wallets) {
        conErr("No wallet addresses provided.");
        return 0;
    }
    conLog("Wallets:", wallets);
    const normalizedWallets = normalizeWallets(wallets);
    if (normalizedWallets.length === 0) {
        conErr("No valid wallet addresses found.");
        return 0;
    }
    conLog("Normalized wallets:", normalizedWallets);

    const walletList = normalizedWallets.map((wallet) => `"${wallet}"`).join(", ");
    conLog("Normalized wallet list:", walletList);

    const query = `query CheckTokenOwnership {
        TokenBalances(
          input: {
            filter: {
              tokenAddress: {_eq: "0xD94393cd7fCCeb749cD844E89167d4a2CDC64541"},
              owner: {_in: [${walletList}]}
            },
            blockchain: base
          }
        ) {
          TokenBalance {
            formattedAmount
          }
        }
    }`;

    const { data, error } = await fetchQuery(query);
    if (error) {
        conErr("Error fetching GRND balance:", error);
        return 0;
    }
    conLog("GRND Balance Data:", data);

    const totalBalance = data?.TokenBalances?.TokenBalance.reduce(
        (acc: number, token: any) => acc + parseFloat(token.formattedAmount),
        0
    );
    conLog("Total GRND Balance:", totalBalance);
    return totalBalance || 0;
}

// Normalize Ethereum address
function normalizeAddress(address: string): string | null {
    if (!address) return null;
    if (!address.match(/^0x[a-fA-F0-9]{40}$/)) {
        return null;
    }
    return address.toLowerCase();
}

function normalizeWallets(wallets: string[] | string): string[] {
    if (typeof wallets === "string") {
        try {
            // Attempt to parse the string if it's a JSON stringified array
            wallets = JSON.parse(wallets);
        } catch {
            // If parsing fails, assume it's a single address string
            wallets = [wallets];
        }
    }

    // Remove duplicates and normalize all addresses
    const uniqueWallets = Array.from(new Set(wallets));
    return uniqueWallets.map(normalizeAddress).filter((address): address is string => address !== null);
}

// Resolve user input to match against NSO pass holders
async function resolveInput(inputText: string | number): Promise<NSOPassHolder | null> {
    if (!inputText) {
        conErr("No input text provided");
        return null;
    }

    conLog("Original input:", inputText);

    const nsoPassHolders = await fetchNSOPassHolders();
    if (nsoPassHolders.length === 0) {
        conErr("No NSO pass holders found");
        return null;
    }

    // Ensure input is treated as a string
    let inputString = String(inputText).trim().toLowerCase();
    conLog("Processed input as string:", inputString);

    // Check if input is a numeric fid
    if (/^\d+$/.test(inputString)) {
        conLog("Input is recognized as a numeric FID:", inputString);
        const fidMatch = nsoPassHolders.find((holder) => String(holder.fid) === inputString);
        if (fidMatch) {
            conLog("Matched by FID:", fidMatch);
            return fidMatch;
        } else {
            conLog(`No match found for FID: ${inputString}`);
            return null;
        }
    }

    // Check if input is an Ethereum address
    const normalizedAddress = normalizeAddress(inputString);
    if (normalizedAddress) {
        // conLog("Input is recognized as an Ethereum address:", normalizedAddress);
        const addressMatch = nsoPassHolders.find((holder) => holder.verified_addresses.includes(normalizedAddress));
        if (addressMatch) {
            // conLog("Matched by Ethereum address:", addressMatch);
            return addressMatch;
        }
    }

    // Check if input is a direct match for fname
    const directMatch = nsoPassHolders.find((holder) => holder.fname.toLowerCase() === inputString);
    if (directMatch) {
        // conLog("Matched by direct fname:", directMatch);
        return directMatch;
    }

    // Fuzzy search by fname as a last resort
    const options = {
        keys: ["fname"],
        threshold: 0.3, // Adjust threshold as needed
    };
    const fuse = new Fuse(nsoPassHolders, options);
    const fuzzyResults = fuse.search(inputString);
    if (fuzzyResults.length > 0) {
        // conLog("Matched by fuzzy search:", fuzzyResults[0].item);
        return fuzzyResults[0].item;
    }

    // No match found
    // conLog("No match found for input:", inputString);
    return null;
}

// Format number with K, M, B, T suffixes
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

async function returnSnapshotDate(): Promise<string | null> {
    return "Updated every 6h";
}

function renderNotFoundScreen(c: any, customFID: string | null, debug: boolean = false) {
    if (debug) {
        conLog("Entering renderNotFoundScreen");
        conLog("Custom FID:", customFID);
    }

    if (debug) conErr("User not found or invalid FID:", customFID);

    const response = c.res({
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
                    style={{ width: "100%", height: "100%", objectFit: "contain", opacity: 0.15 }}
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
                        USER/FID {customFID ? `'${customFID}'` : ""} NOT FOUND 😢
                    </div>
                    <div style={{ marginBottom: "20px" }}>THIS USER IS NOT A PASSHOLDER OR WAS NOT FOUND.</div>
                </div>
                <div
                    className="footer"
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
                        style={{ width: "75px", display: "flex" }}
                    />
                </div>
            </div>
        ),
        intents: [
            <TextInput placeholder="FID, username, or wallet." />,
            <Button>🔎</Button>,
            <Button action="/approve-grnd">Mint NSO v2</Button>,
        ],
        title: "UNDRGRND Stats",
    });

    if (debug) conLog("Rendered not found screen response:", response);

    return response;
}

export const app = new Frog({
    apiKey: process.env.AIRSTACK_API_KEY as string,
    headers: {
        "cache-control": "max-age=0",
    },
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

app.frame("/cast-actions", async function (c) {
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
                    className="footer"
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
                        style={{ width: "75px", display: "flex" }}
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
                    className="footer"
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
                        style={{ width: "75px", display: "flex" }}
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
                        top: "30%",
                    }}
                >
                    <div style={{ marginBottom: "20px" }}>Welcome to UNDRGRND!</div>
                    <div style={{ marginBottom: "20px" }}>Check your stats</div>
                    <div style={{ marginBottom: "20px" }}>and mint your pass below 👇</div>
                </div>
                <div
                    className="footer"
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
                        style={{ width: "75px", display: "flex" }}
                    />
                </div>
            </div>
        ),
        intents: [
            <TextInput placeholder="FID, username, or wallet." />,
            <Button>🔎</Button>,
            <Button action="/approve-grnd">Mint NSO v2</Button>,
            <Button.Redirect location="https://warpcast.com/skllzrmy/0x30ecd6ff">Tip</Button.Redirect>,
        ],
        title: "UNDRGRND Stats",
    });
});

app.frame("/stats/:inputText?", onchainDataMiddleware, async (c) => {
    const { inputText, frameData } = c;
    const { fid } = frameData;
    const initialFID = parseInt(fid);
    const urlParamInputText = c.req.param("inputText");

    // Prioritize the inputs as: URL param -> manually typed input -> FID from frameData
    const customFID = (urlParamInputText as string) || (inputText as string) || (initialFID as string) || null;

    conLog("URL Param Input:", urlParamInputText);
    conLog("Manually Typed Input:", inputText);
    conLog("FID from frameData:", initialFID);
    conLog("Custom FID to resolve:", customFID);

    let nsoPassHolder = null;
    if (customFID) {
        nsoPassHolder = await resolveInput(customFID);
        conLog("Resolved NSO Pass Holder:", nsoPassHolder);
    }
    conLog("NSO Pass Holder:", nsoPassHolder);
    if (!nsoPassHolder) {
        return renderNotFoundScreen(c, customFID, true); // Toggle debugging by setting the third parameter
    }

    conLog("Rendering NSO Pass Holder Data:", nsoPassHolder);

    return c.res({
        action: "/stats",
        image: `/img/stat/${nsoPassHolder.fid}`,
        intents: [
            <TextInput placeholder="FID, username, or wallet." />,
            <Button>🔎</Button>,
            <Button action="/approve-grnd">Mint NSO v2</Button>,
            <Button.Redirect
                location={`https://warpcast.com/~/compose?text=Check%20your%20GRND%20stats%20in%20frame%21%20by%20%40skllzrmy&embeds[]=https://grnd-stats.fly.dev/img/stat/${
                    nsoPassHolder.fid
                }/${new Date().getTime()}&embeds[]=https://grnd-stats.fly.dev/`}
            >
                Share
            </Button.Redirect>,
        ],
        title: "GRND Stats",
    });
});

app.image("/img/stat/:fid/:timestamp?", async (c) => {
    const { fid } = c.req.param();
    const parsedFID = parseInt(fid, 10);
    conLog("Parsed FID:", parsedFID);
    conLog("isNaN:", isNaN(parsedFID));
    if (isNaN(parsedFID)) {
        return renderNotFoundScreen(c, parsedFID.toString(), true); // Toggle debugging by setting the third parameter
    }

    const nsoPassHolders = await fetchNSOPassHolders();
    const nsoPassHolder = nsoPassHolders.find((holder) => parseInt(holder.fid, 10) === parsedFID);
    conLog("NSO Pass Holder:", !!nsoPassHolder);
    if (!nsoPassHolder) {
        return renderNotFoundScreen(c, parsedFID.toString(), true); // Toggle debugging by setting the third parameter
    }
    // Fetch the GRND balance for the verified addresses of the NSO pass holder
    const grndBalance = await fetchGRNDBalance(nsoPassHolder.verified_addresses);

    const profileName = nsoPassHolder.fname;
    const passHolderColor = nsoPassHolder ? "green" : "red";
    const latestSnapshotDate = await returnSnapshotDate();

    let grndSent = nsoPassHolder.total_grnd_spent;
    let currentMultiplier = "0";
    let holderMultiplier = "5x";
    let percentOfGoal = (grndSent / 30_000_000) * 100;
    // Final debug log before rendering the UI
    conLog("Final rendering data:", {
        nsoPassHolder,
        grndBalance,
        inputUsed: fid,
        fallbackTriggered: !nsoPassHolder,
    });

    // Ensure that no incorrect fallback rendering is happening
    if (!nsoPassHolder) {
        conErr("Fallback triggered when it shouldn't be.");
    } else {
        conLog("Fallback check not triggered.");
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
                            <strong>Never Sellout Vol.02:</strong> {nsoPassHolder ? "HODLR 💎🤲" : "👎🚫😢"}
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
                            <strong>GRND Spent:</strong>{" "}
                            {grndSent ? formatNumber(parseInt(grndSent.toString(), 10)) : nsoPassHolder ? "0" : "🚫"}
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
                                    color: nsoPassHolder ? "green" : "white",
                                }}
                            >
                                {nsoPassHolder ? holderMultiplier : "🚫"}
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
                            <strong>S2 Refund:</strong>
                            <span
                                style={{
                                    fontSize: "1em",
                                    fontWeight: "bold",
                                    verticalAlign: "text-baseline",
                                    color: nsoPassHolder ? "green" : "white",
                                }}
                            >
                                {nsoPassHolder ? formatNumber(Math.min(grndSent * 5, 150000000)) : "🚫"}
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
                            <strong>% of Max Refund:</strong>
                            <span
                                style={{
                                    fontSize: "1em",
                                    fontWeight: "bold",
                                    verticalAlign: "text-baseline",
                                    color: nsoPassHolder ? "green" : "white",
                                }}
                            >
                                {nsoPassHolder ? Math.min(parseFloat(percentOfGoal.toFixed(2)), 100) + "%" : "🚫"}
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
                            <strong>GRND Balance:</strong>{" "}
                            {grndBalance ? formatNumber(parseInt(grndBalance.toString(), 10)) : "🚫"}
                        </div>
                    </div>
                </div>
                <div
                    className="footer"
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
                    className="footer"
                    style={{
                        display: "flex",
                        backgroundColor: "white",
                        padding: "10px",
                        margin: "0px auto",
                        borderRadius: "15px",
                        border: "2px dashed #000",
                    }}
                >
                    <img
                        src="https://grnd-stats.fly.dev/skllzrmy.png"
                        alt="skllzrmys logo"
                        style={{ width: "75px", display: "flex" }}
                    />
                </div>
                <div
                    className="footer"
                    style={{
                        position: "absolute",
                        display: "flex",
                        bottom: "8px",
                        right: "300px",
                        color: "white",
                        fontSize: "0.8em",
                    }}
                >
                    Season 2: Aug 2024
                </div>
            </div>
        ),
        headers: {
            "Cache-Control": "max-age=0",
        },
    });
});

app.frame("/top", onchainDataMiddleware, async (c) => {
    return c.res({
        action: "/top",
        image: `/img/top/${new Date().getTime()}`,
        intents: [
            <Button.Redirect location="https://warpcast.com/~/compose?embeds[]=https://grnd-stats.fly.dev/top">
                Share
            </Button.Redirect>,
            <Button action="/approve-grnd">Mint NSO v2</Button>,
        ],
        title: "Top 10 List",
    });
});

app.image("/img/top/:timestamp?", async (c) => {
    const nsoPassHolders = await fetchNSOPassHolders();
    const top10List = nsoPassHolders.sort((a, b) => b.total_grnd_spent - a.total_grnd_spent).slice(0, 10);
    const latestSnapshotDate = await returnSnapshotDate();

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
                    <div style={{ marginBottom: "40px", fontSize: "1.9em", display: "flex" }}>
                        <span style={{ fontSize: "0.7em", lineHeight: "1.9em" }}>🔳 top 10</span> GRND SPNDRs{" "}
                        <span style={{ fontSize: "0.65em", lineHeight: "1.9em" }}>ssn 2 🔳</span>
                    </div>
                </div>
                <div
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        justifyContent: "center",
                        gap: "5px",
                        alignItems: "center",
                        color: "white",
                        fontSize: "0.9em",
                        fontStyle: "normal",
                        letterSpacing: "-0.025em",
                        lineHeight: 1.4,
                        marginTop: "10%",
                        padding: "2%",
                        whiteSpace: "pre-wrap",
                        width: "60%",
                    }}
                >
                    {top10List.map((item, index) => (
                        <div
                            key={index}
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                width: "30%",
                                padding: "0.5% 1.5%",
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
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                                <span style={{ fontSize: "1.25em", fontWeight: "800" }}>
                                    {item.fname === "N/A"
                                        ? JSON.parse(item.verified_addresses)[0].length > 7
                                            ? `${JSON.parse(item.verified_addresses)[0].slice(0, 3)}...${JSON.parse(
                                                  item.verified_addresses
                                              )[0].slice(-4)}`
                                            : JSON.parse(item.verified_addresses)[0]
                                        : item.fname}
                                </span>
                                <span style={{ fontSize: "1.25em" }}> {formatNumber(item.total_grnd_spent)}</span>
                            </div>
                        </div>
                    ))}
                </div>
                <div
                    className="footer"
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
                    className="footer"
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
                        style={{ width: "75px", display: "flex" }}
                    />
                </div>
                <div
                    className="footer"
                    style={{
                        position: "absolute",
                        display: "flex",
                        bottom: "8px",
                        right: "300px",
                        color: "white",
                        fontSize: "0.8em",
                    }}
                >
                    Season 2: Aug 2024
                </div>
            </div>
        ),
        headers: {
            "Cache-Control": "max-age=1800",
        },
    });
});

app.frame("/nso", onchainDataMiddleware, async (c) => {
    return c.res({
        action: "/mint-nso",
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
                        lineHeight: "1.9em",
                        marginTop: "20px",
                        padding: "0",
                        whiteSpace: "pre-wrap",
                        position: "absolute",
                        top: "5%",
                        left: "0",
                        right: "0",
                        bottom: "35%",
                    }}
                >
                    <img
                        src="/nsov2.png"
                        alt="NSO v2"
                        style={{ width: "450px", height: "80%", objectFit: "contain" }}
                    />
                    <div style={{ marginBottom: "20px" }}>Approve 10M GRND</div>
                    <div style={{ marginBottom: "20px" }}>to mint your NSO v2</div>
                    <div style={{ fontSize: ".5em", fontStyle: "italic" }}>photo by @jacque - styled by @uzzy</div>
                </div>
                <div
                    className="footer"
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
                        style={{ width: "75px", display: "flex" }}
                    />
                </div>
            </div>
        ),
        intents: [<Button.Transaction target="/approve">Approve GRND</Button.Transaction>],
        title: "Mint Never Sellout Vol.02",
    });
});

app.frame("/approve-grnd", onchainDataMiddleware, async (c) => {
    return c.res({
        action: "/mint-nso",
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
                        lineHeight: "1.9em",
                        marginTop: "20px",
                        padding: "0",
                        whiteSpace: "pre-wrap",
                        position: "absolute",
                        top: "5%",
                        left: "0",
                        right: "0",
                        bottom: "35%",
                    }}
                >
                    <img
                        src="/nsov2.png"
                        alt="NSO v2"
                        style={{ width: "450px", height: "80%", objectFit: "contain" }}
                    />
                    <div style={{ marginBottom: "20px" }}>Approve 10M GRND</div>
                    <div style={{ marginBottom: "20px" }}>to mint your NSO v2</div>
                    <div style={{ fontSize: ".5em", fontStyle: "italic" }}>photo by @jacque - styled by @uzzy</div>
                </div>
                <div
                    className="footer"
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
                        style={{ width: "75px", display: "flex" }}
                    />
                </div>
            </div>
        ),
        intents: [<Button.Transaction target="/approve">Approve GRND</Button.Transaction>],
        title: "Approve GRND",
    });
});

app.frame("/mint-nso", onchainDataMiddleware, async (c) => {
    return c.res({
        action: "/success",
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
                        lineHeight: "1.9em",
                        marginTop: "20px",
                        padding: "0",
                        whiteSpace: "pre-wrap",
                        position: "absolute",
                        top: "5%",
                        left: "0",
                        right: "0",
                        bottom: "35%",
                    }}
                >
                    <img
                        src="/nsov2.png"
                        alt="NSO v2"
                        style={{ width: "450px", height: "80%", objectFit: "contain" }}
                    />
                    <div style={{ marginBottom: "20px" }}>NEXT click 'Mint NSO v2'</div>
                    <div style={{ marginBottom: "20px" }}>to claim your pass</div>
                    <div style={{ fontSize: ".5em", fontStyle: "italic" }}>photo by @jacque - styled by @uzzy</div>
                </div>
                <div
                    className="footer"
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
                        style={{ width: "75px", display: "flex" }}
                    />
                </div>
            </div>
        ),
        intents: [<Button.Transaction target="/claim">Mint NSO v2</Button.Transaction>],
        title: "Mint NSO v2",
    });
});

app.frame("/success", onchainDataMiddleware, async (c) => {
    return c.res({
        action: "/",
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
                        top: "30%",
                    }}
                >
                    <div style={{ marginBottom: "20px" }}>Success!</div>
                    <div style={{ marginBottom: "20px" }}>Welcome to Season 2!</div>
                    <div style={{ marginBottom: "20px" }}>Share & Follow our channels 👇</div>
                </div>
                <div
                    className="footer"
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
                        style={{ width: "75px", display: "flex" }}
                    />
                </div>
            </div>
        ),
        intents: [
            <Button.Redirect location="https://warpcast.com/~/compose?text=I%20just%20minted%20Never%20Sell%20Out%20vol%2002%20in%20frame%21%20by%20%40skllzrmy&embeds[]=https://grnd-stats.fly.dev/">
                Share
            </Button.Redirect>,
            <Button.Redirect location="https://warpcast.com/~/channel/neversellout/">/neversellout</Button.Redirect>,
            <Button.Redirect location="https://warpcast.com/~/channel/undrgrnd/">/undrgrnd</Button.Redirect>,
            <Button action="/">Back</Button>,
        ],
        title: "Success!",
    });
});

app.transaction("/approve", onchainDataMiddleware, async (c) => {
    const address: `0x${string}` = c.address as `0x${string}`;
    const tokenContractAddress: `0x${string}` = "0xD94393cd7fCCeb749cD844E89167d4a2CDC64541";
    const nftContractAddress: `0x${string}` = "0x2d3819c5b92f813848229d9294F84CF2e55014A1";
    const amount = BigInt("10000000000000000000000000"); // 10 million tokens in wei

    const erc20ABI = [
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

    try {
        const approveTx = c.contract({
            abi: erc20ABI,
            chainId: "eip155:8453",
            functionName: "approve",
            args: [nftContractAddress, amount],
            to: tokenContractAddress,
        });

        return approveTx;
    } catch (error) {
        conErr("Approval transaction preparation failed", error);
        throw new Error("Approval transaction preparation failed");
    }
});

app.transaction("/claim", onchainDataMiddleware, async (c) => {
    const { address } = c;
    const nftContractAddress: `0x${string}` = "0x2d3819c5b92f813848229d9294F84CF2e55014A1";
    const tokenContractAddress: `0x${string}` = "0xD94393cd7fCCeb749cD844E89167d4a2CDC64541";
    const amount = BigInt("10000000000000000000000000"); // 10 million tokens in wei
    const quantity = BigInt("1"); // Quantity of tokens to mint, assuming 18 decimals

    const nsoABI = [
        {
            inputs: [
                { internalType: "address", name: "_receiver", type: "address" },
                { internalType: "uint256", name: "_quantity", type: "uint256" },
                { internalType: "address", name: "_currency", type: "address" },
                { internalType: "uint256", name: "_pricePerToken", type: "uint256" },
                {
                    internalType: "tuple",
                    name: "_allowlistProof",
                    type: "tuple",
                    components: [
                        { internalType: "bytes32[]", name: "proof", type: "bytes32[]" },
                        { internalType: "uint256", name: "quantityLimitPerWallet", type: "uint256" },
                        { internalType: "uint256", name: "pricePerToken", type: "uint256" },
                        { internalType: "address", name: "currency", type: "address" },
                    ],
                },
                { internalType: "bytes", name: "_data", type: "bytes" },
            ],
            name: "claim",
            outputs: [],
            stateMutability: "payable",
            type: "function",
        },
    ] as const;

    const allowlistProof = {
        proof: ["0x0000000000000000000000000000000000000000000000000000000000000000"] as const,
        quantityLimitPerWallet: quantity,
        pricePerToken: amount,
        currency: tokenContractAddress,
    };

    try {
        const claimTx = c.contract({
            abi: nsoABI,
            chainId: "eip155:8453",
            functionName: "claim",
            args: [address, quantity, tokenContractAddress, amount, allowlistProof, "0x"],
            to: nftContractAddress,
        });

        return claimTx;
    } catch (error) {
        conErr("Claim transaction preparation failed", error);
        throw new Error("Claim transaction preparation failed");
    }
});

app.use("/*", serveStatic({ root: "./public" }));
devtools(app, { serveStatic });

if (typeof Bun !== "undefined") {
    Bun.serve({
        fetch: app.fetch,
        port: 3000,
    });
    conLog("Server is running on port 3000");
}
