import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export function GET() { return NextResponse.json({ name: "ReEditX", status: "ok", version: "1.0.0", mediaProcessing: "browser-local", persistence: "IndexedDB", engine: "deterministic-browser-media-engine", timestamp: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } }); }
