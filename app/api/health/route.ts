import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const renderConfigured = Boolean(process.env.REEDITX_RENDER_SERVER_URL && process.env.REEDITX_RENDER_API_TOKEN);
  return NextResponse.json({
    name: "ReEditX",
    status: "ok",
    version: "1.0.0",
    mediaProcessing: renderConfigured ? "hybrid-local-and-remote" : "browser-local",
    persistence: "IndexedDB",
    engine: "deterministic-browser-media-engine",
    renderWorkerConfigured: renderConfigured,
    timestamp: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
