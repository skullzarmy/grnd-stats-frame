// logUtils.js
const DEBUG = process.env.DEBUG === "true";

export function conLog(...args: any[]): void {
    if (DEBUG) {
        console.log(...args);
    }
}

export function conErr(...args: any[]): void {
    if (DEBUG) {
        console.error(...args);
    }
}
