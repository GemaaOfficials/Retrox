import { NextResponse } from "next/server";
import { getRenderJob, publicRenderJob } from "@/lib/render-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: "Invalid render job ID." }, { status: 400 });
  const job = getRenderJob(jobId);
  if (!job) return NextResponse.json({ error: "This render job has expired or doesn't exist." }, { status: 404 });
  return NextResponse.json(publicRenderJob(job), { headers: { "Cache-Control": "no-store" } });
}
