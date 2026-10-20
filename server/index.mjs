import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_FILE_BYTES = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 1024)) * 1024 * 1024;
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

await fsp.mkdir(ROOT, { recursive: true });
await fsp.mkdir(UPLOADS, { recursive: true });

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
    if (job.audioPath) args.push("-i", job.audioPath);

    const filterParts = [`[0:v:0]${filters}[vout]`];
    const hasSong = Boolean(job.audioPath);
    const hasSourceAudio = job.sourceHasAudio;
    const outputDuration = job.outputDuration;
    const fadeIn = Math.min(job.settings.fadeIn, outputDuration);
    const fadeOut = Math.min(job.settings.fadeOut, outputDuration);
    const musicFilters = [`volume=${(job.settings.volume / 100).toFixed(3)}`];
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
    writeJob(job, { status: "complete", percent: 100, message: "Server render complete.", outputBytes: stat.size, outputName: "ReEditX-remix.mp4", process: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render failed.";
    writeJob(job, { status: "failed", percent: 0, message: "Server render failed.", error: message.slice(0, 1800), process: null });
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
  res.json({ name: "ReEditX Render Worker", status: "ok", engine: "ffmpeg", active: activeCount, queued: queue.length, maxConcurrent: MAX_ACTIVE, maxUploadBytes: MAX_FILE_BYTES, timestamp: new Date().toISOString() });
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
    try {
      if (!video) { if (audio?.path) await fsp.rm(audio.path, { force: true }); return res.status(400).json({ error: "A video file is required.", code: "VIDEO_REQUIRED" }); }
      if (activeCount + queue.length >= MAX_ACTIVE + MAX_QUEUE) {
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
      const id = crypto.randomUUID();
      directory = path.join(ROOT, id);
      await fsp.mkdir(directory, { recursive: true });
      const videoPath = path.join(directory, "source" + path.extname(video.originalname).toLowerCase());
      await fsp.rename(video.path, videoPath);
      let audioPath = null;
      if (audio) {
        audioPath = path.join(directory, "soundtrack" + path.extname(audio.originalname).toLowerCase());
        await fsp.rename(audio.path, audioPath);
      }
      const job = { id, status: "queued", percent: 0, message: "Waiting for an available render slot.", createdAt: Date.now(), updatedAt: Date.now(), directory, videoPath, audioPath, outputPath: path.join(directory, "ReEditX-remix.mp4"), settings, duration: inspection.duration, outputDuration, sourceHasAudio: inspection.hasAudio, outputName: "ReEditX-remix.mp4", error: null, process: null };
      jobs.set(id, job);
      queue.push(job);
      startNext();
      return res.status(202).json({ jobId: id, status: job.status, statusUrl: `/api/jobs/${id}` });
    } catch (error) {
      if (video?.path) await fsp.rm(video.path, { force: true }).catch(() => {});
      if (audio?.path) await fsp.rm(audio.path, { force: true }).catch(() => {});
      if (directory) await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
      return next(error);
    }
  });
});

function getJob(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return jobs.get(id) || null;
}

app.get("/api/jobs/:id", authenticate, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Render job not found or expired.", code: "JOB_NOT_FOUND" });
  return res.json(publicJob(job));
});

app.get("/api/jobs/:id/download", authenticate, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Render job not found or expired.", code: "JOB_NOT_FOUND" });
  if (job.status !== "complete" || !fs.existsSync(job.outputPath)) return res.status(409).json({ error: "This render is not ready to download yet.", code: "JOB_NOT_READY" });
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Cache-Control", "no-store");
  res.download(job.outputPath, job.outputName);
});

app.use((error, _req, res, _next) => {
  const message = error instanceof Error ? error.message : "Unexpected render service error.";
  if (error?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `Media exceeds the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB per-file server limit.`, code: "FILE_TOO_LARGE" });
  if (error?.message?.includes("Origin is not allowed")) return res.status(403).json({ error: "This origin is not allowed.", code: "ORIGIN_DENIED" });
  if (error?.code === "ENOENT") return res.status(503).json({ error: "FFmpeg/FFprobe is missing from the render worker.", code: "MEDIA_TOOLS_MISSING" });
  return res.status(400).json({ error: message.slice(0, 1200), code: "RENDER_REQUEST_FAILED" });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`ReEditX render worker listening on ${HOST}:${PORT}`);
  console.log(`Max concurrent renders: ${MAX_ACTIVE}; upload limit: ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB per file`);
  if (!TOKEN && production) console.error("RENDER_API_TOKEN is required in production; authenticated endpoints will return 503.");
});

const cleanup = setInterval(async () => {
  const before = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.updatedAt < before && job.status !== "running" && job.status !== "queued") {
      jobs.delete(id);
      await fsp.rm(job.directory, { recursive: true, force: true }).catch(() => {});
    }
  }
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
  for (const job of jobs.values()) if (job.process && !job.process.killed) job.process.kill("SIGTERM");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
