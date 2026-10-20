import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function config() {
  const base = process.env.REEDITX_RENDER_SERVER_URL?.replace(/\/+$/, "");
  const token = process.env.REEDITX_RENDER_API_TOKEN;
  if (!base || !token) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
    return { base, token };
  } catch { return null; }
}

export async function POST(request: Request) {
  const remote = config();
  if (!remote) return NextResponse.json({ error: "Remote rendering is not configured on the ReEditX server.", code: "SERVER_NOT_CONFIGURED" }, { status: 503 });
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) return NextResponse.json({ error: "Upload a video and optional soundtrack as multipart form data.", code: "INVALID_CONTENT_TYPE" }, { status: 415 });
  if (!request.body) return NextResponse.json({ error: "The media upload body is empty.", code: "EMPTY_BODY" }, { status: 400 });
  try {
    const upstream = await fetch(`${remote.base}/api/render`, {
      method: "POST",
      headers: { Authorization: `Bearer ${remote.token}`, "Content-Type": contentType },
      body: request.body,
      duplex: "half",
      signal: AbortSignal.timeout(60 * 60 * 1000),
    } as RequestInit & { duplex: "half" });
    return new Response(upstream.body, { status: upstream.status, headers: { "Content-Type": upstream.headers.get("content-type") || "application/json", "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The render server is unreachable. Check the ReEditX render service deployment.", code: "RENDER_SERVER_UNAVAILABLE" }, { status: 502 });
  }
}
