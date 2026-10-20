import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { findRenderOutput, getRenderJob, scheduleRenderCleanup } from "@/lib/render-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: "Invalid render job ID." }, { status: 400 });
  const job = getRenderJob(jobId);
  const output = findRenderOutput(jobId);
  if (!job || !output) return NextResponse.json({ error: "The render isn't ready or has expired." }, { status: 404 });
  try {
    const fileStat = await stat(output.path);
    const stream = createReadStream(output.path);
    stream.once("close", () => scheduleRenderCleanup(jobId, 10 * 60 * 1000));
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(fileStat.size),
        "Content-Disposition": 'attachment; filename="' + output.name.replace(/["\\\r\n]/g, "_") + '"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "The rendered file is no longer available." }, { status: 404 });
  }
}
