import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_FILE_BYTES = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 50)) * 1024 * 1024;
const MAX_DURATION = Math.min(8 * 60 * 60, Math.max(60, Number(process.env.MAX_MEDIA_SECONDS || 4 * 60 * 60)));
const MAX_ACTIVE = Math.min(4, Math.max(1, Number(process.env.MAX_CONCURRENT_RENDERS || 1)));
const MAX_QUEUE = Math.max(1, Number(process.env.MAX_QUEUED_RENDERS || 4));
const JOB_TTL_MS = Math.max(15 * 60 * 1000, Number(process.env.JOB_TTL_HOURS || 3) * 60 * 60 * 1000);
const ROOT = process.env.REEDITX_JOB_DIR || path.join(os.tmpdir(), "reeditx-render-jobs");
const UPLOADS = path.join(os.tmpdir(), "reeditx-uploads");
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const TOKEN = process.env.RENDER_API_TOKEN || "";
const production = process.env.NODE_ENV === "production";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const SUPABASE_BUCKET = process.env.REEDITX_STORAGE_BUCKET || "reeditx-media";
const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
const WORKER_ID = process.env.RENDER_WORKER_ID || crypto.randomUUID();
let supabasePolling = false;


await fsp.mkdir(ROOT, { recursive: true });
await fsp.mkdir(UPLOADS, { recursive: true });

function supabaseHeaders(extra = {}) {
  return { apikey: SUPABASE_SERVICE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_KEY, ...extra };
}

async function supabaseRequest(pathname, options = {}) {
  if (!SUPABASE_CONFIGURED) throw new Error("Supabase is not configured on the render worker.");
  const headers = supabaseHeaders(options.headers || {});
  if (typeof options.body === "string" && !headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(SUPABASE_URL + pathname, { ...options, headers });
  const text = await response.text();
  if (!response.ok) throw new Error("Supabase request failed (" + response.status + "): " + text.slice(0, 500));
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function encodeObjectPath(objectPath) {
  return objectPath.split("/").map(encodeURIComponent).join("/");
}

function supabaseObjectUrl(objectPath, access = "") {
  return SUPABASE_URL + "/storage/v1/object/" + (access ? access + "/" : "") +
    encodeURIComponent(SUPABASE_BUCKET) + "/" + encodeObjectPath(objectPath);
}

async function uploadToSupabaseStorage(localPath, objectPath, contentType) {
  if (!SUPABASE_CONFIGURED || !objectPath) return;
  const fileInfo = await fsp.stat(localPath);
  const response = await fetch(supabaseObjectUrl(objectPath), {
    method: "POST",
    headers: supabaseHeaders({
      "Content-Type": contentType || "application/octet-stream",
      "Content-Length": String(fileInfo.size),
      "x-upsert": "true",
    }),
    body: fs.createReadStream(localPath),
    duplex: "half",
  });
  const text = await response.text();
  if (!response.ok) throw new Error("Supabase Storage upload failed (" + response.status + "): " + text.slice(0, 500));
}

async function downloadFromSupabaseStorage(objectPath, localPath) {
  if (!SUPABASE_CONFIGURED || !objectPath) throw new Error("Supabase Storage path is missing.");
  const response = await fetch(supabaseObjectUrl(objectPath, "authenticated"), { headers: supabaseHeaders(), cache: "no-store" });
  if (!response.ok || !response.body) {
    const message = await response.text().catch(() => "");
    throw new Error("Could not restore media from Supabase Storage (" + response.status + "): " + message.slice(0, 300));
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(localPath));
}

async function deleteSupabaseStorageObject(objectPath) {
  if (!SUPABASE_CONFIGURED || !objectPath) return;
  const response = await fetch(supabaseObjectUrl(objectPath), { method: "DELETE", headers: supabaseHeaders() });
  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "");
    throw new Error("Supabase Storage delete failed (" + response.status + "): " + text.slice(0, 300));
  }
}

function recordForJob(job) {
  return {
    id: job.id,
    status: job.status === "running" ? "processing" : job.status,
    progress: Math.max(0, Math.min(100, Math.round(Number(job.percent) || 0))),
    message: job.message || "",
    source_video_path: job.sourceVideoObjectPath || null,
    source_audio_path: job.sourceAudioObjectPath || null,
    output_object_path: job.outputObjectPath || null,
    settings: job.settings || {},
    duration_seconds: Number(job.duration) || null,
    output_duration_seconds: Number(job.outputDuration) || null,
    source_has_audio: Boolean(job.sourceHasAudio),
    output_name: job.outputName || "ReEditX-remix.mp4",
    output_bytes: Number(job.outputBytes) || null,
    error_message: job.error || null,
    client_token_hash: job.clientTokenHash || undefined,
    created_at: new Date(job.createdAt || Date.now()).toISOString(),
    updated_at: new Date(job.updatedAt || Date.now()).toISOString(),
    expires_at: new Date(job.expiresAt || ((job.createdAt || Date.now()) + JOB_TTL_MS)).toISOString(),
  };
}

async function upsertSupabaseJob(job) {
  await supabaseRequest("/rest/v1/reeditx_render_jobs?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(recordForJob(job)),
  });
  job.lastPersistAt = Date.now();
  job.lastPersistStatus = job.status;
  job.lastPersistProgress = job.percent;
  job.persistChain = Promise.resolve();
}

function scheduleSupabasePersist(job, force = false) {
  if (!SUPABASE_CONFIGURED) return Promise.resolve();
  const now = Date.now();
  const statusChanged = job.lastPersistStatus !== job.status;
  const progressMoved = Math.abs((Number(job.percent) || 0) - (Number(job.lastPersistProgress) || 0)) >= 5;
  const intervalElapsed = now - (job.lastPersistAt || 0) >= 4000;
  if (!force && !statusChanged && !progressMoved && !intervalElapsed) return job.persistChain || Promise.resolve();
  const snapshot = recordForJob(job);
  job.lastPersistAt = now;
  job.lastPersistStatus = job.status;
  job.lastPersistProgress = job.percent;
  const previous = job.persistChain || Promise.resolve();
  job.persistChain = previous
    .catch(() => undefined)
    .then(() => supabaseRequest("/rest/v1/reeditx_render_jobs?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(snapshot),
    }))
    .catch(error => console.error("Could not persist render job " + job.id + " to Supabase:", error instanceof Error ? error.message : String(error)));
  return job.persistChain;
}

async function countOpenSupabaseJobs() {
  const params = new URLSearchParams({
    select: "id",
    status: "in.(queued,processing)",
    expires_at: "gt." + new Date().toISOString(),
  });
  const rows = await supabaseRequest("/rest/v1/reeditx_render_jobs?" + params.toString(), { method: "GET" });
  return Array.isArray(rows) ? rows.length : 0;
}

async function readSupabaseJob(id) {
  if (!SUPABASE_CONFIGURED) return null;
  const params = new URLSearchParams({ select: "*", id: "eq." + id });
  const rows = await supabaseRequest("/rest/v1/reeditx_render_jobs?" + params.toString(), { method: "GET" });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function jobFromSupabaseRow(row) {
  const directory = path.join(ROOT, row.id);
  const videoObjectPath = row.source_video_path || null;
  const audioObjectPath = row.source_audio_path || null;
  const videoExtension = path.extname(videoObjectPath || ".mp4") || ".mp4";
  const audioExtension = path.extname(audioObjectPath || ".mp3") || ".mp3";
  const createdAt = Date.parse(row.created_at) || Date.now();
  return {
    id: row.id,
    status: row.status === "processing" ? "running" : row.status,
    percent: Math.max(0, Math.min(100, Number(row.progress) || 0)),
    message: row.message || "Restored render job from Supabase.",
    createdAt,
    updatedAt: Date.parse(row.updated_at) || Date.now(),
    expiresAt: Date.parse(row.expires_at) || createdAt + JOB_TTL_MS,
    directory,
    videoPath: path.join(directory, "source-video" + videoExtension),
    audioPath: audioObjectPath ? path.join(directory, "soundtrack" + audioExtension) : null,
    outputPath: path.join(directory, "ReEditX-remix.mp4"),
    settings: settingsSchema.parse(row.settings || {}),
    duration: Number(row.duration_seconds) || 0,
    outputDuration: Number(row.output_duration_seconds) || 0,
    sourceHasAudio: Boolean(row.source_has_audio),
    outputName: row.output_name || "ReEditX-remix.mp4",
    outputBytes: Number(row.output_bytes) || undefined,
    error: row.error_message || null,
    clientTokenHash: row.client_token_hash || undefined,
    sourceVideoObjectPath: videoObjectPath,
    sourceAudioObjectPath: audioObjectPath,
    outputObjectPath: row.output_object_path || null,
    process: null,
    lastPersistAt: Date.now(),
    lastPersistStatus: row.status === "processing" ? "running" : row.status,
    lastPersistProgress: Number(row.progress) || 0,
    persistChain: Promise.resolve(),
  };
}

async function materializeClaimedSupabaseJob(row) {
  let job = jobs.get(row.id);
  if (job) {
    writeJob(job, { status: "running", percent: Math.max(1, Number(row.progress) || 1), message: "Worker claimed this job from the Supabase queue." });
    return job;
  }
  job = jobFromSupabaseRow(row);
  await fsp.mkdir(job.directory, { recursive: true });
  if (!fs.existsSync(job.videoPath)) await downloadFromSupabaseStorage(job.sourceVideoObjectPath, job.videoPath);
  if (job.audioPath && !fs.existsSync(job.audioPath)) await downloadFromSupabaseStorage(job.sourceAudioObjectPath, job.audioPath);
  if (!job.duration || !job.outputDuration) {
    const inspection = await probeVideo(job.videoPath);
    job.duration = inspection.duration;
    job.outputDuration = inspection.duration / job.settings.speed;
    job.sourceHasAudio = inspection.hasAudio;
  }
  jobs.set(job.id, job);
  writeJob(job, { status: "running", percent: Math.max(1, job.percent), message: "Media restored. Preparing FFmpeg render." });
  await scheduleSupabasePersist(job, true);
  return job;
}

async function pollSupabaseQueue() {
  if (!SUPABASE_CONFIGURED || supabasePolling) return;
  supabasePolling = true;
  try {
    while (activeCount < MAX_ACTIVE) {
      const claimed = await supabaseRequest("/rest/v1/rpc/claim_reeditx_render_job", {
        method: "POST",
        body: JSON.stringify({ p_worker_id: WORKER_ID }),
      });
      const row = Array.isArray(claimed) ? claimed[0] : null;
      if (!row) break;
      activeCount += 1;
      void (async () => {
        let job = null;
        try {
          job = await materializeClaimedSupabaseJob(row);
          await runJob(job);
        } catch (error) {
          job = job || jobFromSupabaseRow(row);
          jobs.set(job.id, job);
          writeJob(job, {
            status: "failed",
            percent: 0,
            message: "The render worker could not restore this job.",
            error: (error instanceof Error ? error.message : String(error)).slice(0, 1800),
            process: null,
          });
          await scheduleSupabasePersist(job, true);
          await fsp.rm(job.directory, { recursive: true, force: true }).catch(() => {});
          console.error("Supabase render job " + row.id + " failed to start:", error instanceof Error ? error.message : String(error));
        } finally {
          activeCount = Math.max(0, activeCount - 1);
          void pollSupabaseQueue();
        }
      })();
    }
  } catch (error) {
    console.error("Supabase render queue poll failed:", error instanceof Error ? error.message : String(error));
  } finally {
    supabasePolling = false;
  }
}

async function cleanupSupabaseExpiredJobs() {
  if (!SUPABASE_CONFIGURED) return;
  const params = new URLSearchParams({
    select: "id,source_video_path,source_audio_path,output_object_path",
    expires_at: "lt." + new Date().toISOString(),
    status: "in.(complete,failed)",
  });
  const rows = await supabaseRequest("/rest/v1/reeditx_render_jobs?" + params.toString(), { method: "GET" });
  if (!Array.isArray(rows)) return;
  for (const row of rows.slice(0, 50)) {
    for (const objectPath of [row.source_video_path, row.source_audio_path, row.output_object_path]) {
      await deleteSupabaseStorageObject(objectPath).catch(error => console.error("Could not clean up expired Supabase media:", error instanceof Error ? error.message : String(error)));
    }
    await supabaseRequest("/rest/v1/reeditx_render_jobs?id=eq." + encodeURIComponent(row.id), { method: "DELETE" }).catch(error => {
      console.error("Could not delete expired Supabase job " + row.id + ":", error instanceof Error ? error.message : String(error));
    });
  }
}


const settingsSchema = z.object({
  speed: z.number().finite().min(0.25).max(2).default(1),
  volume: z.number().int().min(0).max(100).default(70),
  sourceVolume: z.number().int().min(0).max(100).default(85),
  fadeIn: z.number().finite().min(0).max(10).default(1),
  fadeOut: z.number().finite().min(0).max(15).default(2),
  aspect: z.enum(["original", "portrait", "square", "landscape"]).default("original"),
  preset: z.enum(["none", "cinema", "mono", "dream", "neon"]).default("cinema"),
  rhythm: z.enum(["steady", "punchy", "slow"]).default("steady"),
  title: z.string().max(90).default(""),
  subtitle: z.string().max(120).default(""),
  animatedTitles: z.boolean().default(true),
  useQuickCuts: z.boolean().default(false),
});

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY || 0));
app.use(helmet({ crossOriginResourcePolicy: false }));
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000")
  .split(",").map(value => value.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
    if (/^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) && process.env.ALLOW_LOCALHOST_ORIGINS === "true") return callback(null, true);
    return callback(new Error("Origin is not allowed by the ReEditX render server."));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 600,
}));
app.use(express.json({ limit: "32kb" }));

const generalLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });
const renderLimiter = rateLimit({ windowMs: 15 * 60_000, limit: Number(process.env.RENDER_REQUESTS_PER_15_MIN || 6), standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Render request limit reached. Try again later.", code: "RATE_LIMITED" } });
app.use(generalLimiter);

function authenticate(req, res, next) {
  if (!TOKEN) {
    if (production) return res.status(503).json({ error: "Render service is not configured with RENDER_API_TOKEN.", code: "SERVER_NOT_CONFIGURED" });
    return next();
  }
  const supplied = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const got = Buffer.from(supplied);
  const expected = Buffer.from(TOKEN);
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
    return res.status(401).json({ error: "Invalid render service credentials.", code: "UNAUTHORIZED" });
  }
  return next();
}

function childOutput(binary, args, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = ""; let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Media inspection timed out.")); }, timeoutMs);
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim().slice(-1200) || `${binary} exited with code ${code}`));
      resolve(stdout.trim());
    });
  });
}

async function probeVideo(filePath) {
  const [durationText, audioText] = await Promise.all([
    childOutput(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]),
    childOutput(FFPROBE, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath]).catch(() => ""),
  ]);
  const duration = Number(durationText);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("The uploaded file does not contain a readable video track.");
  if (duration > MAX_DURATION) throw new Error(`Video exceeds the server limit of ${Math.round(MAX_DURATION / 60)} minutes.`);
  return { duration, hasAudio: Boolean(audioText) };
}

function atempoFilter(speed) {
  if (speed < 0.5) return `atempo=0.5,atempo=${(speed / 0.5).toFixed(4)}`;
  if (speed > 2) return `atempo=2,atempo=${(speed / 2).toFixed(4)}`;
  return `atempo=${speed.toFixed(4)}`;
}

function buildVideoFilters(settings, directory) {
  const filters = [];
  filters.push(`setpts=PTS/${settings.speed}`);
  if (settings.aspect === "portrait") filters.push("scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280");
  else if (settings.aspect === "square") filters.push("scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080");
  else if (settings.aspect === "landscape") filters.push("scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720");
  else filters.push("scale='min(1920,iw)':-2");
  if (settings.preset === "cinema") filters.push("eq=contrast=1.12:brightness=-0.03:saturation=1.16");
  if (settings.preset === "mono") filters.push("hue=s=0,eq=contrast=1.12");
  if (settings.preset === "dream") filters.push("eq=brightness=0.04:saturation=1.28");
  if (settings.preset === "neon") filters.push("eq=contrast=1.12:saturation=1.6");

  const fontFile = process.env.FONT_FILE || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  if ((settings.title || settings.subtitle) && fs.existsSync(fontFile)) {
    if (settings.title) {
      const titlePath = path.join(directory, "title.txt");
      fs.writeFileSync(titlePath, settings.title, "utf8");
      filters.push(`drawtext=fontfile='${fontFile}':textfile='${titlePath}':expansion=none:fontcolor=white:fontsize=h*0.052:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.78:alpha=${settings.animatedTitles ? "'min(1,t*3.8)'" : "1"}`);
    }
    if (settings.subtitle) {
      const subtitlePath = path.join(directory, "subtitle.txt");
      fs.writeFileSync(subtitlePath, settings.subtitle, "utf8");
      filters.push(`drawtext=fontfile='${fontFile}':textfile='${subtitlePath}':expansion=none:fontcolor=0xB5FFF6:fontsize=h*0.022:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h*0.85`);
    }
  }
  if (settings.rhythm === "punchy" && settings.useQuickCuts) {
    // The client sends candidate scene boundaries; FFmpeg trim segments are a separate future enhancement.
    filters.push("eq=brightness=0.01");
  }
  return filters.join(",");
}

const jobs = new Map();
const queue = [];
let activeCount = 0;

function publicJob(job) {
  return { id: job.id, status: job.status, percent: job.percent, progress: job.percent, message: job.message, duration: job.duration, outputDuration: job.outputDuration, createdAt: job.createdAt, updatedAt: job.updatedAt, error: job.status === "failed" ? job.error : undefined, outputName: job.status === "complete" ? job.outputName : undefined };
}

function writeJob(job, changes) {
  Object.assign(job, changes, { updatedAt: Date.now() });
  void scheduleSupabasePersist(job);
}

function startNext() {
  while (activeCount < MAX_ACTIVE && queue.length > 0) {
    const job = queue.shift();
    if (!job || job.status !== "queued") continue;
    activeCount += 1;
    void runJob(job).finally(() => { activeCount -= 1; startNext(); });
  }
}

async function runJob(job) {
  try {
    writeJob(job, { status: "running", percent: 1, message: "Starting FFmpeg render worker." });
    const filters = buildVideoFilters(job.settings, job.directory);
    const args = ["-hide_banner", "-y", "-i", job.videoPath];
    if (job.audioPath) args.push("-stream_loop", "-1", "-i", job.audioPath);

    const filterParts = [`[0:v:0]${filters}[vout]`];
    const hasSong = Boolean(job.audioPath);
    const hasSourceAudio = job.sourceHasAudio;
    const outputDuration = job.outputDuration;
    const fadeIn = Math.min(job.settings.fadeIn, outputDuration);
    const fadeOut = Math.min(job.settings.fadeOut, outputDuration);
    const musicFilters = [atempoFilter(job.settings.speed), `volume=${(job.settings.volume / 100).toFixed(3)}`];
    if (fadeIn > 0) musicFilters.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
    if (fadeOut > 0 && outputDuration > fadeOut) musicFilters.push(`afade=t=out:st=${(outputDuration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);

    if (hasSourceAudio && hasSong) {
      filterParts.push(`[0:a:0]${atempoFilter(job.settings.speed)},volume=${(job.settings.sourceVolume / 100).toFixed(3)}[sourcea]`);
      filterParts.push(`[1:a:0]${musicFilters.join(",")}[musica]`);
      filterParts.push("[sourcea][musica]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]");
    } else if (hasSourceAudio) {
      filterParts.push(`[0:a:0]${atempoFilter(job.settings.speed)},volume=${(job.settings.sourceVolume / 100).toFixed(3)}[aout]`);
    } else if (hasSong) {
      filterParts.push(`[1:a:0]${musicFilters.join(",")}[aout]`);
    }

    args.push("-filter_complex", filterParts.join(";"), "-map", "[vout]");
    if (hasSourceAudio || hasSong) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
    else args.push("-an");
    args.push("-c:v", "libx264", "-preset", process.env.FFMPEG_PRESET || "veryfast", "-crf", process.env.FFMPEG_CRF || "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", outputDuration.toFixed(3), "-progress", "pipe:1", "-nostats", job.outputPath);

    await new Promise((resolve, reject) => {
      const child = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      job.process = child;
      let buffer = ""; let stderrTail = "";
      child.stdout.on("data", chunk => {
        buffer += chunk.toString();
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
          if (line.startsWith("out_time_ms=")) {
            const timeUs = Number(line.slice("out_time_ms=".length));
            if (Number.isFinite(timeUs) && job.outputDuration > 0) {
              const percent = Math.max(1, Math.min(99, Math.round((timeUs / 1_000_000 / job.outputDuration) * 100)));
              writeJob(job, { percent, message: "Rendering frames and mixing audio." });
            }
          } else if (line === "progress=end") writeJob(job, { percent: 99, message: "Finalizing the MP4 file." });
        }
      });
      child.stderr.on("data", chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-3500); });
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve() : reject(new Error(stderrTail.trim().slice(-1700) || `FFmpeg exited with code ${code}`)));
      job.process = child;
    });

    const stat = await fsp.stat(job.outputPath);
    if (stat.size < 1024) throw new Error("FFmpeg produced an invalid or empty output file.");
    if (SUPABASE_CONFIGURED && job.outputObjectPath) {
      writeJob(job, { percent: 99, message: "Uploading the completed MP4 to private Supabase Storage." });
      await uploadToSupabaseStorage(job.outputPath, job.outputObjectPath, "video/mp4");
    }
    writeJob(job, { status: "complete", percent: 100, message: "Server render complete.", outputBytes: stat.size, outputName: "ReEditX-remix.mp4", process: null });
    await scheduleSupabasePersist(job, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render failed.";
    writeJob(job, { status: "failed", percent: 0, message: "Server render failed.", error: message.slice(0, 1800), process: null });
    await scheduleSupabasePersist(job, true);
    await fsp.rm(job.outputPath, { force: true }).catch(() => {});
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, UPLOADS),
  filename: (_req, file, callback) => callback(null, crypto.randomUUID() + path.extname(file.originalname || "").toLowerCase().slice(0, 10)),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: 2, fields: 1, fieldSize: 16 * 1024 },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowedVideo = new Set([".mp4", ".mov", ".webm", ".m4v", ".mkv"]);
    const allowedAudio = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".webm", ".mp4"]);
    const okay = file.fieldname === "video" ? allowedVideo.has(ext) : file.fieldname === "audio" ? allowedAudio.has(ext) : false;
    if (!okay) return callback(new Error("Unsupported media extension. Use MP4, MOV, WebM, MP3, WAV, M4A, AAC, OGG, OPUS or FLAC."));
    callback(null, true);
  },
}).fields([{ name: "video", maxCount: 1 }, { name: "audio", maxCount: 1 }]);

const healthHandler = (_req, res) => {
  res.json({
    name: "ReEditX Render Worker",
    status: "ok",
    engine: "ffmpeg",
    queueBackend: SUPABASE_CONFIGURED ? "supabase-postgres" : "in-memory",
    supabaseConfigured: SUPABASE_CONFIGURED,
    active: activeCount,
    queued: queue.length,
    maxConcurrent: MAX_ACTIVE,
    maxUploadBytes: MAX_FILE_BYTES,
    timestamp: new Date().toISOString(),
  });
};
// Public, low-detail endpoint for the hosting platform's health probe.
app.get("/health", healthHandler);
// Protected health check used by the Next.js proxy to verify the shared token.
app.get("/api/health", authenticate, healthHandler);

app.post("/api/render", authenticate, renderLimiter, (req, res, next) => {
  upload(req, res, async error => {
    if (error) return next(error);
    const files = req.files || {};
    const video = files.video?.[0];
    const audio = files.audio?.[0];
    let directory = null;
    let jobId = null;
    let sourceVideoObjectPath = null;
    let sourceAudioObjectPath = null;
    let outputObjectPath = null;
    let rowPersisted = false;
    try {
      if (!video) { if (audio?.path) await fsp.rm(audio.path, { force: true }); return res.status(400).json({ error: "A video file is required.", code: "VIDEO_REQUIRED" }); }
      if (production && !SUPABASE_CONFIGURED) {
        await fsp.rm(video.path, { force: true });
        if (audio) await fsp.rm(audio.path, { force: true });
        return res.status(503).json({ error: "Supabase is not configured on this render worker.", code: "SUPABASE_NOT_CONFIGURED" });
      }
      const openJobs = SUPABASE_CONFIGURED ? await countOpenSupabaseJobs() : activeCount + queue.length;
      if (openJobs >= MAX_ACTIVE + MAX_QUEUE) {
        await fsp.rm(video.path, { force: true }); if (audio) await fsp.rm(audio.path, { force: true });
        return res.status(429).json({ error: "The render queue is full. Try again in a few minutes.", code: "QUEUE_FULL" });
      }
      let settings;
      try {
        const raw = typeof req.body?.settings === "string" ? JSON.parse(req.body.settings) : req.body?.settings ?? {};
        settings = settingsSchema.parse(raw);
      } catch {
        await fsp.rm(video.path, { force: true }); if (audio) await fsp.rm(audio.path, { force: true });
        return res.status(400).json({ error: "Editing settings are invalid.", code: "INVALID_SETTINGS" });
      }
      if (video.size < 1024) {
        await fsp.rm(video.path, { force: true }); if (audio) await fsp.rm(audio.path, { force: true });
        return res.status(400).json({ error: "The uploaded video is empty or too small.", code: "INVALID_MEDIA" });
      }
      if (audio && audio.size < 256) {
        await fsp.rm(video.path, { force: true }); await fsp.rm(audio.path, { force: true });
        return res.status(400).json({ error: "The uploaded soundtrack is empty or too small.", code: "INVALID_MEDIA" });
      }
      const inspection = await probeVideo(video.path);
      const outputDuration = inspection.duration / settings.speed;
      if (outputDuration > MAX_DURATION * 2) throw new Error("Requested output duration exceeds the server safety limit.");
      jobId = crypto.randomUUID();
      const id = jobId;
      directory = path.join(ROOT, id);
      await fsp.mkdir(directory, { recursive: true });
      const videoExtension = path.extname(video.originalname).toLowerCase();
      const videoPath = path.join(directory, "source-video" + videoExtension);
      await fsp.rename(video.path, videoPath);
      let audioPath = null;
      let audioExtension = "";
      if (audio) {
        audioExtension = path.extname(audio.originalname).toLowerCase();
        audioPath = path.join(directory, "soundtrack" + audioExtension);
        await fsp.rename(audio.path, audioPath);
      }
      sourceVideoObjectPath = SUPABASE_CONFIGURED ? "jobs/" + id + "/source-video" + videoExtension : null;
      sourceAudioObjectPath = SUPABASE_CONFIGURED && audio ? "jobs/" + id + "/soundtrack" + audioExtension : null;
      outputObjectPath = SUPABASE_CONFIGURED ? "jobs/" + id + "/ReEditX-remix.mp4" : null;
      const job = {
        id,
        status: "queued",
        percent: 0,
        message: SUPABASE_CONFIGURED ? "Waiting in the persistent Supabase render queue." : "Waiting for an available render slot.",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + JOB_TTL_MS,
        directory,
        videoPath,
        audioPath,
        outputPath: path.join(directory, "ReEditX-remix.mp4"),
        settings,
        duration: inspection.duration,
        outputDuration,
        sourceHasAudio: inspection.hasAudio,
        outputName: "ReEditX-remix.mp4",
        error: null,
        outputBytes: null,
        sourceVideoObjectPath,
        sourceAudioObjectPath,
        outputObjectPath,
        process: null,
        persistChain: Promise.resolve(),
      };
      if (SUPABASE_CONFIGURED) {
        await uploadToSupabaseStorage(videoPath, sourceVideoObjectPath, video.mimetype || "application/octet-stream");
        if (audioPath && sourceAudioObjectPath) await uploadToSupabaseStorage(audioPath, sourceAudioObjectPath, audio.mimetype || "application/octet-stream");
        await upsertSupabaseJob(job);
        rowPersisted = true;
        jobs.set(id, job);
        void pollSupabaseQueue();
      } else {
        jobs.set(id, job);
        queue.push(job);
        startNext();
      }
      return res.status(202).json({ jobId: id, status: job.status, statusUrl: `/api/jobs/${id}` });
    } catch (error) {
      if (jobId) jobs.delete(jobId);
      if (sourceVideoObjectPath) await deleteSupabaseStorageObject(sourceVideoObjectPath).catch(() => {});
      if (sourceAudioObjectPath) await deleteSupabaseStorageObject(sourceAudioObjectPath).catch(() => {});
      if (outputObjectPath) await deleteSupabaseStorageObject(outputObjectPath).catch(() => {});
      if (rowPersisted && jobId && SUPABASE_CONFIGURED) await supabaseRequest("/rest/v1/reeditx_render_jobs?id=eq." + encodeURIComponent(jobId), { method: "DELETE" }).catch(() => {});
      if (video?.path) await fsp.rm(video.path, { force: true }).catch(() => {});
      if (audio?.path) await fsp.rm(audio.path, { force: true }).catch(() => {});
      if (directory) await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
      return next(error);
    }
  });
});

async function resolveJobForRequest(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const local = jobs.get(id);
  if (local) return local;
  const row = await readSupabaseJob(id);
  return row ? jobFromSupabaseRow(row) : null;
}

app.get("/api/jobs/:id", authenticate, async (req, res, next) => {
  try {
    const job = await resolveJobForRequest(req.params.id);
    if (!job) return res.status(404).json({ error: "Render job not found or expired.", code: "JOB_NOT_FOUND" });
    return res.json(publicJob(job));
  } catch (error) { return next(error); }
});

app.get("/api/jobs/:id/download", authenticate, async (req, res, next) => {
  try {
    const job = await resolveJobForRequest(req.params.id);
    if (!job) return res.status(404).json({ error: "Render job not found or expired.", code: "JOB_NOT_FOUND" });
    if (job.status !== "complete") return res.status(409).json({ error: "This render is not ready to download yet.", code: "JOB_NOT_READY" });
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (fs.existsSync(job.outputPath)) return res.download(job.outputPath, job.outputName || "ReEditX-remix.mp4");
    if (!SUPABASE_CONFIGURED || !job.outputObjectPath) {
      return res.status(404).json({ error: "The completed MP4 is no longer available.", code: "OUTPUT_NOT_FOUND" });
    }
    const response = await fetch(supabaseObjectUrl(job.outputObjectPath, "authenticated"), { headers: supabaseHeaders(), cache: "no-store" });
    if (!response.ok || !response.body) {
      return res.status(502).json({ error: "Could not retrieve the MP4 from Supabase Storage.", code: "STORAGE_DOWNLOAD_FAILED" });
    }
    res.setHeader("Content-Disposition", 'attachment; filename="' + (job.outputName || "ReEditX-remix.mp4").replace(/["\\\r\n]/g, "_") + '"');
    const contentLength = response.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    Readable.fromWeb(response.body).on("error", error => res.destroy(error)).pipe(res);
  } catch (error) { return next(error); }
});

app.use((error, _req, res, _next) => {
  const message = error instanceof Error ? error.message : "Unexpected render service error.";
  if (error?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `Media exceeds the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB per-file server limit.`, code: "FILE_TOO_LARGE" });
  if (error?.message?.includes("Origin is not allowed")) return res.status(403).json({ error: "This origin is not allowed.", code: "ORIGIN_DENIED" });
  if (error?.code === "ENOENT") return res.status(503).json({ error: "FFmpeg/FFprobe is missing from the render worker.", code: "MEDIA_TOOLS_MISSING" });
  return res.status(400).json({ error: message.slice(0, 1200), code: "RENDER_REQUEST_FAILED" });
});

async function persistWorkerHeartbeat() {
 if(!SUPABASE_CONFIGURED)return;
 const now=new Date().toISOString();
 try{await supabaseRequest("/rest/v1/reeditx_worker_heartbeats?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({id:WORKER_ID,last_seen_at:now,active_jobs:activeCount,queued_jobs:queue.length,updated_at:now})});}
 catch(error){console.error("Could not update the ReEditX worker heartbeat:",error instanceof Error?error.message:String(error));}
}
const server = app.listen(PORT, HOST, () => {
  console.log(`ReEditX render worker listening on ${HOST}:${PORT}`);
  console.log(`Max concurrent renders: ${MAX_ACTIVE}; upload limit: ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB per file`);
  if (!TOKEN && production) console.error("RENDER_API_TOKEN is required in production; authenticated endpoints will return 503.");
  if (!SUPABASE_CONFIGURED && production) console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for persistent production rendering.");
});

const supabasePollTimer = SUPABASE_CONFIGURED ? setInterval(() => { void pollSupabaseQueue(); }, 1500) : null;
supabasePollTimer?.unref();
const heartbeatTimer = SUPABASE_CONFIGURED ? setInterval(() => { void persistWorkerHeartbeat(); }, 15000) : null;
heartbeatTimer?.unref();
if (SUPABASE_CONFIGURED) { void pollSupabaseQueue(); void persistWorkerHeartbeat(); }

const cleanup = setInterval(async () => {
  const before = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.updatedAt < before && job.status !== "running" && job.status !== "queued") {
      jobs.delete(id);
      await fsp.rm(job.directory, { recursive: true, force: true }).catch(() => {});
    }
  }
  await cleanupSupabaseExpiredJobs().catch(error => console.error("Supabase expiry cleanup failed:", error instanceof Error ? error.message : String(error)));
  // Reap orphan upload temp files older than one day.
  const files = await fsp.readdir(UPLOADS, { withFileTypes: true }).catch(() => []);
  for (const file of files) {
    const full = path.join(UPLOADS, file.name);
    const stat = await fsp.stat(full).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) await fsp.rm(full, { recursive: true, force: true }).catch(() => {});
  }
}, 60 * 60 * 1000);
cleanup.unref();

function shutdown() {
  clearInterval(cleanup);
  if (supabasePollTimer) clearInterval(supabasePollTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  for (const job of jobs.values()) if (job.process && !job.process.killed) job.process.kill("SIGTERM");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
