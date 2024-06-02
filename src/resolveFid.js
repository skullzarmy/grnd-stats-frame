// resolveFid.js
// import { client, gql } from "./airstackClient";
import pkg from "@airstack/frames";
const { searchFarcasterUsers, SearchFarcasterUsersInput, SearchFarcastersOutput, fetchQuery } = pkg;
import { ethers } from "ethers";

// Function to resolve ENS name to wallet address using ethers.js
async function resolveEnsName(ensName) {
    const provider = new ethers.providers.JsonRpcProvider();
    const address = await provider.resolveName(ensName);
    return address;
}

// Function to get FID from wallet address using Airstack
async function getFidFromWallet(walletAddress) {
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
async function getFidFromUsername(username) {
    const { data } = await searchFarcasterUsers({ profileName: username });
    // if return is empty, return null, else search for exact string match and return fid, else return top result
    let dreturn = null;
    if (data && data.length > 0) {
        for (let i = 0; i < data.length; i++) {
            if (data[i].profileName === username) {
                dreturn = data[i].fid;
                break;
            }
        }
        if (dreturn === null) {
            dreturn = data[0].fid;
        }
    }
    // const dreturn = data && data.length > 0 ? data[0].fid : null;
    return dreturn;
}

// Function to resolve input to FID
export async function resolveInputToFID(inputText) {
    let fid;

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
