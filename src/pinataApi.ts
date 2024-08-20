import fs from "fs/promises";
import path from "path";
import { conLog, conErr } from "./logUtils.js";

const PINATA_API_JWT = process.env.PINATA_API_JWT;

if (!PINATA_API_JWT) {
    conErr("PINATA_API_JWT is missing.");
    throw new Error("Pinata API initialization failed due to missing JWT.");
}

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

const CACHE_TIMEOUT = parseInt(process.env.PINATA_CACHE_TIMEOUT || "3600", 10) * 1000; // 1 hour
const CACHE_DIR = path.resolve(process.cwd(), ".pinata-cache");

async function getCacheFilePath(cacheKey: string): Promise<string> {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    return path.join(CACHE_DIR, `${cacheKey}.json`);
}

async function readCache<T>(cacheKey: string): Promise<CacheEntry<T> | null> {
    try {
        const cachePath = await getCacheFilePath(cacheKey);
        const cacheContent = await fs.readFile(cachePath, "utf-8");
        return JSON.parse(cacheContent) as CacheEntry<T>;
    } catch {
        return null;
    }
}

async function writeCache<T>(cacheKey: string, data: T): Promise<void> {
    const cachePath = await getCacheFilePath(cacheKey);
    const cacheEntry: CacheEntry<T> = { data, timestamp: Date.now() };
    await fs.writeFile(cachePath, JSON.stringify(cacheEntry), "utf-8");
}

async function fetchPinataData(endpoint: string): Promise<any | null> {
    const url = `https://api.pinata.cloud/v3/farcaster${endpoint}`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                accept: "application/json",
                authorization: `Bearer ${PINATA_API_JWT}`,
            },
        });

        if (!response.ok) {
            conErr(`Pinata API request failed: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json();
        conLog(`Pinata API request successful: ${url}`);
        return data.user;
    } catch (error) {
        conErr("Error fetching data from Pinata API:", error);
        return null;
    }
}

export async function getUserByFID(fid: number): Promise<any | null> {
    const cacheKey = `pinata_user_${fid}`;
    const cachedData = await readCache<any>(cacheKey);

    if (cachedData && Date.now() - cachedData.timestamp < CACHE_TIMEOUT) {
        conLog(`Serving user data for FID ${fid} from cache.`);
        return cachedData.data;
    }

    const data = await fetchPinataData(`/users/${fid}`);
    if (data) {
        await writeCache(cacheKey, data);
    }

    return data;
}

export async function getUserDataByFID(fid: number): Promise<any | null> {
    const cacheKey = `pinata_userdata_${fid}`;
    const cachedData = await readCache<any>(cacheKey);

    if (cachedData && Date.now() - cachedData.timestamp < CACHE_TIMEOUT) {
        conLog(`Serving user data messages for FID ${fid} from cache.`);
        return cachedData.data;
    }

    const url = `https://hub.pinata.cloud/v1/userDataByFid?fid=${fid}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            conErr(`Failed to fetch user data by FID from Pinata Hub: ${response.status} ${response.statusText}`);
            return null;
        }
        const data = await response.json();
        await writeCache(cacheKey, data.messages);
        return data.messages;
    } catch (error) {
        conErr("Error fetching user data by FID:", error);
        return null;
    }
}
