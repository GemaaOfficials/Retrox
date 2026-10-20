import Busboy from "@fastify/busboy";
import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { RenderSettingsSchema, createRenderJob, renderCapacityAvailable } from "@/lib/render-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES * 2 + 2 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mpeg", ".mpg"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".webm"]);

type UploadResult = { videoPath: string; videoName: string; audioPath?: string; audioName?: string; settingsText: string };

declare global {
  // Basic per-process protection. For multiple instances, replace with a shared Redis limiter.
  var __reeditxRenderRate?: Map<string, number[]>;
}

function getClientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  return (forwarded || real || "unknown-client").slice(0, 100);
}
function verifyOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim().toLowerCase();
    return !host || originHost === host;
  } catch { return false; }
}
function allowRate(clientKey: string) {
  const rates = globalThis.__reeditxRenderRate ?? (globalThis.__reeditxRenderRate = new Map<string, number[]>());
  const now = Date.now();
  const times = (rates.get(clientKey) || []).filter(t => now - t < 15 * 60 * 1000);
  if (times.length >= 3) { rates.set(clientKey, times); return false; }
  times.push(now); rates.set(clientKey, times);
  if (rates.size > 2000) {
    for (const [key, values] of rates) if (values.every(t => now - t >= 15 * 60 * 1000)) rates.delete(key);
  }
  return true;
}
function safeDisplayName(name: string) {
  return name.replace(/[\r\n\u0000-\u001f]/g, "").replace(/[\\/]/g, "_").slice(0, 180) || "media";
}
function parseUpload(request: Request, directory: string): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const contentType = request.headers.get("content-type");
    if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
      reject(Object.assign(new Error("Upload must use multipart/form-data."), { status: 415 })); return;
    }
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: { "content-type": contentType },
        limits: { files: 2, fileSize: MAX_FILE_BYTES, fields: 8, fieldSize: 16 * 1024, parts: 10, headerPairs: 100 },
      });
    } catch {
      reject(Object.assign(new Error("Invalid upload form."), { status: 400 })); return;
    }
    const writes: Promise<void>[] = [];
    let videoPath = "", videoName = "", audioPath: string | undefined, audioName: string | undefined;
    let settingsText = "";
    let parseError: Error | undefined;
    const fail = (message: string, status = 400) => { parseError ??= Object.assign(new Error(message), { status }); };
    parser.on("file", (fieldName, stream, filename, _encoding, mimeType) => {
      const originalName = safeDisplayName(typeof filename === "string" ? filename : "");
      const extension = extname(originalName).toLowerCase();
      const isVideo = fieldName === "video" && !videoPath;
      const isAudio = fieldName === "audio" && !audioPath;
      if ((!isVideo && !isAudio) || (isVideo && !VIDEO_EXTENSIONS.has(extension)) || (isAudio && !AUDIO_EXTENSIONS.has(extension))) {
        fail("Upload one supported video and, optionally, one supported audio file. Unsupported file: " + originalName, 415);
        stream.resume(); return;
      }
      if (isVideo && mimeType && !mimeType.startsWith("video/") && mimeType !== "application/octet-stream") {
        fail("The main file does not appear to be a video.", 415); stream.resume(); return;
      }
      if (isAudio && mimeType && !mimeType.startsWith("audio/") && ![".webm"].includes(extension) && mimeType !== "application/octet-stream") {
        fail("The soundtrack does not appear to be audio.", 415); stream.resume(); return;
      }
      const destination = join(directory, isVideo ? "source-video" + extension : "source-audio" + extension);
      if (isVideo) { videoPath = destination; videoName = originalName; }
      else { audioPath = destination; audioName = originalName; }
      stream.on("limit", () => fail("Each media file must be 512 MB or smaller.", 413));
      writes.push(pipeline(stream, createWriteStream(destination, { flags: "wx" })).then(() => {
        if (stream.truncated) fail("The media file exceeded the size limit.", 413);
      }).catch(error => { fail(error instanceof Error ? error.message : "Could not save upload."); }));
    });
    parser.on("field", (fieldName, value, _nameTruncated, valueTruncated) => {
      if (valueTruncated) { fail("A form field is too large.", 413); return; }
      if (fieldName === "settings") settingsText = value;
      else if (fieldName !== "clientVersion") fail("Unexpected upload field.", 400);
    });
    parser.on("filesLimit", () => fail("Only a video and one optional soundtrack can be uploaded.", 400));
    parser.on("fieldsLimit", () => fail("Too many form fields.", 400));
    parser.on("partsLimit", () => fail("The upload form has too many parts.", 400));
    parser.on("error", error => reject(error));
    parser.on("finish", async () => {
      try {
        await Promise.all(writes);
        if (parseError) throw parseError;
        if (!videoPath) throw Object.assign(new Error("Select a video before exporting."), { status: 400 });
        if (!settingsText) throw Object.assign(new Error("The render settings were missing."), { status: 400 });
        resolve({ videoPath, videoName, audioPath, audioName, settingsText });
      } catch (error) { reject(error); }
    });
    if (!request.body) { reject(Object.assign(new Error("The upload body is missing."), { status: 400 })); return; }
    Readable.fromWeb(request.body as import("node:stream/web").ReadableStream).pipe(parser);
  });
}

export async function POST(request: Request) {
  if (!verifyOrigin(request)) return NextResponse.json({ error: "Cross-origin render requests are not allowed." }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) return NextResponse.json({ error: "The combined upload must be smaller than about 1 GB." }, { status: 413 });
  if (!renderCapacityAvailable()) return NextResponse.json({ error: "The render server is busy. Please retry in a minute." }, { status: 429 });
  const clientKey = getClientKey(request);
  if (!allowRate(clientKey)) return NextResponse.json({ error: "This device has submitted three renders in 15 minutes. Please wait before trying again." }, { status: 429 });

  const id = randomUUID();
  const dataDir = process.env.REEDITX_DATA_DIR || join(tmpdir(), "reeditx-data");
  const directory = join(dataDir, "render-" + id);
  try {
    await mkdir(directory, { recursive: true });
    const upload = await parseUpload(request, directory);
    let settingsValue: unknown;
    try { settingsValue = JSON.parse(upload.settingsText); } catch { throw Object.assign(new Error("The edit settings were invalid JSON."), { status: 400 }); }
    const parsed = RenderSettingsSchema.safeParse(settingsValue);
    if (!parsed.success) throw Object.assign(new Error("One or more edit settings are invalid."), { status: 400 });
    const job = createRenderJob({
      id, directory, videoPath: upload.videoPath, audioPath: upload.audioPath,
      clientKey, settings: parsed.data,
    });
    return NextResponse.json({
      jobId: job.id, status: job.status, message: "Upload received. The server render has been queued.",
      statusUrl: "/api/render/" + job.id, downloadUrl: "/api/render/" + job.id + "/download",
    }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 400;
    const message = error instanceof Error ? error.message : "Upload failed. Try another media format.";
    return NextResponse.json({ error: message }, { status });
  }
}
