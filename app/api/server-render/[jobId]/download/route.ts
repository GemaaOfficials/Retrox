import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: "Invalid render job ID.", code: "INVALID_JOB_ID" }, { status: 400 });
  const base = process.env.REEDITX_RENDER_SERVER_URL?.replace(/\/+$/, "");
  const token = process.env.REEDITX_RENDER_API_TOKEN;
  if (!base || !token) return NextResponse.json({ error: "Remote rendering is not configured.", code: "SERVER_NOT_CONFIGURED" }, { status: 503 });
  try {
    const response = await fetch(`${base}/api/jobs/${jobId}/download`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(60 * 60 * 1000) });
    const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": response.headers.get("content-type") || "video/mp4" });
    const disposition = response.headers.get("content-disposition");
    if (disposition) headers.set("Content-Disposition", disposition);
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return NextResponse.json({ error: "The render download server could not be reached.", code: "RENDER_SERVER_UNAVAILABLE" }, { status: 502 });
  }
}
