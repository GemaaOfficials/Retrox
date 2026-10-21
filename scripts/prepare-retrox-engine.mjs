import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "node_modules", "@ffmpeg", "core", "dist", "umd");
const destination = path.join(root, "public", "retrox");

await mkdir(path.dirname(destination), { recursive: true });
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
console.log("Copied the pinned single-thread FFmpeg/WASM core to public/retrox for offline local rendering.");
