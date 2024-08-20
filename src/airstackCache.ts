import fs from "fs/promises";
import path from "path";
import { fetchQuery } from "@airstack/frames";
import { conLog, conErr } from "./logUtils.js";

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

const CACHE_TIMEOUT = parseInt(process.env.AIRSTACK_CACHE_TIMEOUT || "3600", 10) * 1000; // 1 hour
const CACHE_DIR = path.resolve(process.cwd(), ".airstack-cache");

async function getCacheFilePath(queryName: string): Promise<string> {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    return path.join(CACHE_DIR, `${queryName}.json`);
}

async function readCache<T>(queryName: string): Promise<CacheEntry<T> | null> {
    try {
        const cachePath = await getCacheFilePath(queryName);
        const cacheContent = await fs.readFile(cachePath, "utf-8");
        return JSON.parse(cacheContent) as CacheEntry<T>;
    } catch {
        return null;
    }
}

async function writeCache<T>(queryName: string, data: T): Promise<void> {
    const cachePath = await getCacheFilePath(queryName);
    const cacheEntry: CacheEntry<T> = { data, timestamp: Date.now() };
    await fs.writeFile(cachePath, JSON.stringify(cacheEntry), "utf-8");
}

export async function fetchCachedAirstackQuery(query: string, queryName: string): Promise<any> {
    const cachedData = await readCache<any>(queryName);

    if (cachedData && Date.now() - cachedData.timestamp < CACHE_TIMEOUT) {
        return cachedData.data;
    }

    // Fetch fresh data from Airstack API
    const { data, error } = await fetchQuery(query);
    if (error) {
        conErr("Error fetching from Airstack:", error);
        return null;
    }

    await writeCache(queryName, data);
    return data;
}
