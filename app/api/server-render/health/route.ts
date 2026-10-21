import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const base = process.env.REEDITX_RENDER_SERVER_URL?.replace(/\/+$/, "");
  const token = process.env.REEDITX_RENDER_API_TOKEN;
  if (!base || !token) return NextResponse.json({ available: false, configured: false, message: "Remote rendering is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    const response = await fetch(`${base}/api/health`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return NextResponse.json({ available: false, configured: true, message: "The render worker is not healthy." }, { status: 502, headers: { "Cache-Control": "no-store" } });
    const info = await response.json() as { supabaseConfigured?: boolean; status?: string; [key: string]: unknown };
    if (info.supabaseConfigured !== true) {
      return NextResponse.json({ available: false, configured: true, message: "The render worker is reachable but its Supabase backend is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ available: true, configured: true, worker: info }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ available: false, configured: true, message: "The render worker could not be reached." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
