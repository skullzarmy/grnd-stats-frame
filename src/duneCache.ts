// duneCache.js
import fs from "fs/promises";
import path from "path";
import { DuneClient } from "@duneanalytics/client-sdk";
import { conLog, conErr } from "./logUtils.js";

const CURRENT_USER = process.env.CURRENT_USER;
const DUNE_API_KEY = process.env[`DUNE_API_KEY_${CURRENT_USER?.toUpperCase() ?? ""}`];
const DUNE_QUERY_ID = process.env[`DUNE_QUERY_ID_${CURRENT_USER?.toUpperCase() ?? ""}`];

if (!CURRENT_USER || !DUNE_API_KEY || !DUNE_QUERY_ID) {
    conErr("Required environment variables (CURRENT_USER, DUNE_API_KEY, DUNE_QUERY_ID) are missing.");
    throw new Error("Dune cache client initialization failed due to missing environment variables.");
}

const CACHE_TIMEOUT = parseInt(process.env.CACHE_TIMEOUT || "21600", 10) * 1000; // Default: 6 hours in milliseconds
const CACHE_DIR = path.resolve(process.cwd(), ".cache");
const duneClient = new DuneClient(DUNE_API_KEY);

type NSOPassHolder = {
    fid: string;
    fname: string;
    verified_addresses: string[];
    total_grnd_spent: number;
};

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

async function getCacheFilePath(): Promise<string> {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    return path.join(CACHE_DIR, `dune_data_${CURRENT_USER}.json`);
}

async function readCache<T>(): Promise<CacheEntry<T> | null> {
    try {
        const cachePath = await getCacheFilePath();
        const cacheContent = await fs.readFile(cachePath, "utf-8");
        return JSON.parse(cacheContent) as CacheEntry<T>;
    } catch (error) {
        conErr("Failed to read cache:", error);
        return null;
    }
}

async function writeCache<T>(data: T): Promise<void> {
    try {
        const cachePath = await getCacheFilePath();
        const cacheEntry: CacheEntry<T> = { data, timestamp: Date.now() };
        await fs.writeFile(cachePath, JSON.stringify(cacheEntry), "utf-8");
    } catch (error) {
        conErr("Failed to write cache:", error);
    }
}

async function fetchNSOPassHoldersFromDune(): Promise<NSOPassHolder[]> {
    if (!DUNE_QUERY_ID) {
        conErr("Dune query ID is missing.");
        return [];
    }
    try {
        const queryResult = await duneClient.getLatestResult({ queryId: parseInt(DUNE_QUERY_ID) });
        if (!queryResult || !queryResult.result) {
            conErr("Failed to fetch data from Dune.");
            return [];
        }

        return queryResult.result.rows.map((row: any) => ({
            fid: row.fid,
            fname: row.fname,
            verified_addresses: row.verified_addresses,
            total_grnd_spent: row.total_grnd_spent,
        }));
    } catch (error) {
        conErr("Error while fetching data from Dune:", error);
        return [];
    }
}

export async function getNSOPassHolders(): Promise<NSOPassHolder[]> {
    const cachedData = await readCache<NSOPassHolder[]>();

    if (cachedData && Date.now() - cachedData.timestamp < CACHE_TIMEOUT) {
        conLog("Serving data from cache.");
        return cachedData.data;
    }

    conLog("Fetching fresh data from Dune.");
    const freshData = await fetchNSOPassHoldersFromDune();
    if (freshData.length > 0) {
        await writeCache(freshData);
    }

    return freshData;
}

export async function invalidateCache(): Promise<void> {
    try {
        const cachePath = await getCacheFilePath();
        await fs.rm(cachePath, { force: true });
        conLog(`Cache for user ${CURRENT_USER} invalidated.`);
    } catch (error) {
        conErr("Failed to invalidate cache:", error);
    }
}
