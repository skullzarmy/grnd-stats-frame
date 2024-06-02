import { Button, Frog, TextInput } from "@airstack/frog";
import {
    onchainDataFrogMiddleware as onchainData,
    TokenBlockchain,
    getFarcasterUserERC20Balances,
    FarcasterUserERC20BalancesInput,
    FarcasterUserERC20BalancesOutput,
    checkTokenHoldByFarcasterUser,
    getFarcasterUserDetails,
} from "@airstack/frames";
import { devtools } from "frog/dev";
import { serveStatic } from "frog/serve-static";
import { resolveInputToFID } from "./resolveFid";

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
                    src="http://localhost:5173/logo.png"
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
            <TextInput placeholder={`Enter any fid, username, wallet, or ENS.`} />,
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
                        src="http://localhost:5173/logo.png"
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
                        <div style={{ marginBottom: "5px", fontSize: "6em" }}>🛑</div>
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
                <TextInput placeholder={`Enter any fid, username, wallet, or ENS.`} />,
                <Button>🔎</Button>,
                <Button.Reset>Reset</Button.Reset>,
                <Button.Redirect location="https://zora.co/collect/base:0xa08a01b9a890e9ad5c26f7257e3558d256df8059/2">
                    Get Pass
                </Button.Redirect>,
                <Button.Redirect location="https://www.undrgrnd.io/claim/">Claim</Button.Redirect>,
            ],
            title: "UNDRGRND Stats",
        });
    }

    return c.res({
        image: `/img/stat/${customFID}`,
        intents: [
            <TextInput placeholder={`Enter any fid, username, wallet, or ENS.`} />,
            <Button>🔎</Button>,
            <Button.Reset>Reset</Button.Reset>,
            <Button.Redirect location="https://zora.co/collect/base:0xa08a01b9a890e9ad5c26f7257e3558d256df8059/2">
                Get Pass
            </Button.Redirect>,
            <Button.Redirect location="https://www.undrgrnd.io/claim/">Claim</Button.Redirect>,
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
                    src="http://localhost:5173/logo.png"
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
                                color: passHolderColor,
                            }}
                        >
                            <strong>Never Sellout Vol.01:</strong>{" "}
                            {ssnPass1Minted.data[0].isHold ? "HODLR 💎🤲" : "👎🚫😢"}
                        </div>
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
                            }}
                        >
                            <strong>Daily Claimable:</strong> {ssnPass1Minted.data[0].isHold ? "500K" : "0"}
                        </div>
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
                            }}
                        >
                            <strong>Daily Claimed:</strong> SOON
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
