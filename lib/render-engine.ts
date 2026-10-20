import { spawn } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const RenderSettingsSchema = z.object({
  volume: z.number().min(0).max(100).default(70),
  sourceVolume: z.number().min(0).max(100).default(85),
  speed: z.number().min(25).max(200).default(100),
  fadeIn: z.number().min(0).max(5).default(1),
  fadeOut: z.number().min(0).max(8).default(2),
  aspect: z.enum(["original", "landscape", "portrait", "square"]).default("original"),
  preset: z.enum(["none", "cinema", "mono", "dream", "neon"]).default("cinema"),
  rhythm: z.enum(["steady", "punchy", "slow"]).default("steady"),
  title: z.string().max(90).default(""),
  subtitle: z.string().max(120).default(""),
  animatedTitles: z.boolean().default(true),
  useQuickCuts: z.boolean().default(false),
  cuts: z.array(z.number().finite().min(0).max(60 * 60 * 8)).max(120).default([]),
});
export type RenderSettings = z.infer<typeof RenderSettingsSchema>;
export type RenderStatus = "queued" | "processing" | "complete" | "failed";
export type RenderJob = {
  id: string;
  status: RenderStatus;
  progress: number;
  message: string;
  createdAt: number;
  updatedAt: number;
  clientKey: string;
  directory: string;
  videoPath: string;
  audioPath?: string;
  outputPath: string;
  outputName: string;
  settings: RenderSettings;
  error?: string;
  outputBytes?: number;
};
type RenderStore = { jobs: Map<string, RenderJob>; queue: string[]; active: number; };
const GLOBAL = globalThis as typeof globalThis & { __reeditxRenderStore?: RenderStore };
const store: RenderStore = GLOBAL.__reeditxRenderStore ?? (GLOBAL.__reeditxRenderStore = { jobs: new Map(), queue: [], active: 0 });
const MAX_ACTIVE = 1;
const MAX_WAITING = 2;

export function renderCapacityAvailable(): boolean {
  const outstanding = [...store.jobs.values()].filter(job => job.status === "queued" || job.status === "processing").length;
  return outstanding < MAX_ACTIVE + MAX_WAITING;
}
export function getRenderJob(id: string): RenderJob | undefined { return store.jobs.get(id); }
export function publicRenderJob(job: RenderJob) {
  return {
    id: job.id, status: job.status, progress: job.progress, message: job.message,
    createdAt: job.createdAt, updatedAt: job.updatedAt, outputName: job.outputName,
    outputBytes: job.outputBytes, error: job.error,
  };
}
export function findRenderOutput(id: string) {
  const job = store.jobs.get(id);
  return job && job.status === "complete" ? { path: job.outputPath, name: job.outputName, dir: job.directory } : null;
}
export function createRenderJob(input: {
  id?: string; directory: string; videoPath: string; audioPath?: string; clientKey: string; settings: RenderSettings;
}): RenderJob {
  if (!renderCapacityAvailable()) throw new Error("The render server is busy. Try again in a minute.");
  const id = input.id ?? randomUUID();
  const createdAt = Date.now();
  const outputName = "ReEditX-" + new Date(createdAt).toISOString().replace(/[:.]/g, "-") + ".mp4";
  const job: RenderJob = {
    id, status: "queued", progress: 0, message: "Queued for the ReEditX render engine.",
    createdAt, updatedAt: createdAt, clientKey: input.clientKey, directory: input.directory,
    videoPath: input.videoPath, audioPath: input.audioPath, outputPath: join(input.directory, "rendered.mp4"),
    outputName, settings: input.settings,
  };
  store.jobs.set(id, job);
  store.queue.push(id);
  pumpQueue();
  return job;
}
export function removeRenderJob(id: string): void {
  const job = store.jobs.get(id);
  if (!job) return;
  store.jobs.delete(id);
  store.queue = store.queue.filter(item => item !== id);
  void fs.rm(job.directory, { recursive: true, force: true }).catch(() => undefined);
}
export function scheduleRenderCleanup(id: string, delayMs = 30 * 60 * 1000): void {
  const timer = setTimeout(() => removeRenderJob(id), delayMs);
  timer.unref?.();
}
function update(job: RenderJob, status: RenderStatus, progress: number, message: string) {
  job.status = status; job.progress = Math.max(0, Math.min(100, Math.round(progress)));
  job.message = message; job.updatedAt = Date.now();
}
function dataDirectory() { return process.env.REEDITX_DATA_DIR || join(tmpdir(), "reeditx-data"); }

function capture(command: string, args: string[], timeoutMs = 25_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let settled = false;
    const timeout = setTimeout(() => { child.kill("SIGKILL"); finish(new Error("Media probe timed out.")); }, timeoutMs);
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timeout);
      if (error) reject(error); else resolve(stdout);
    };
    child.stdout.on("data", chunk => { stdout += String(chunk); if (stdout.length > 2_000_000) child.kill("SIGKILL"); });
    child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-3000); });
    child.once("error", error => finish(error));
    child.once("close", code => code === 0 ? finish() : finish(new Error(stderr.trim() || "Media probe failed.")));
  });
}

function even(value: number) { return Math.max(2, Math.floor(value / 2) * 2); }
function outputDimensions(width: number, height: number, aspect: RenderSettings["aspect"]): [number, number] {
  if (aspect === "landscape") return [1280, 720];
  if (aspect === "portrait") return [720, 1280];
  if (aspect === "square") return [1080, 1080];
  const scale = Math.min(1, 1920 / width, 1920 / height);
  return [even(width * scale), even(height * scale)];
}
function atempo(rate: number): string {
  const factors: number[] = []; let remaining = rate;
  while (remaining > 2.00001) { factors.push(2); remaining /= 2; }
  while (remaining < 0.49999) { factors.push(0.5); remaining /= 0.5; }
  factors.push(Number(remaining.toFixed(5)));
  return factors.map(n => "atempo=" + n).join(",");
}
function visualFilter(preset: RenderSettings["preset"]): string {
  switch (preset) {
    case "cinema": return "eq=contrast=1.12:saturation=1.16:brightness=-0.035";
    case "mono": return "hue=s=0,eq=contrast=1.12";
    case "dream": return "eq=brightness=0.035:saturation=1.28";
    case "neon": return "eq=saturation=1.6:contrast=1.12";
    default: return "null";
  }
}
function titleFilters(settings: RenderSettings, job: RenderJob, height: number): string[] {
  const result: string[] = [];
  const font = process.env.REEDITX_FONT_PATH || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  if (settings.title.trim()) {
    result.push("drawtext=fontfile=" + font + ":textfile=" + join(job.directory, "title.txt") + ":fontsize=" + Math.max(26, Math.round(height * 0.052)) + ":fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.76");
  }
  if (settings.subtitle.trim()) {
    result.push("drawtext=fontfile=" + font + ":textfile=" + join(job.directory, "subtitle.txt") + ":fontsize=" + Math.max(16, Math.round(height * 0.023)) + ":fontcolor=0xB5FFF6:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h*0.85");
  }
  if (settings.useQuickCuts && settings.rhythm === "punchy") {
    for (const cut of settings.cuts.slice(0, 80)) {
      const at = Number((cut / (settings.speed / 100)).toFixed(3));
      if (at >= 0.1) result.push("drawbox=c=white@0.23:t=fill:enable='between(t\\," + at + "\\," + Number((at + 0.12).toFixed(3)) + ")'");
    }
  }
  return result;
}
async function probeVideo(job: RenderJob): Promise<{ width: number; height: number; duration: number; hasAudio: boolean }> {
  const output = await capture(process.env.FFPROBE_PATH || "ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", job.videoPath,
  ]);
  const metadata = JSON.parse(output) as { streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string } };
  const video = metadata.streams?.find(stream => stream.codec_type === "video");
  const duration = Number(metadata.format?.duration);
  if (!video?.width || !video.height || !Number.isFinite(duration) || duration <= 0) throw new Error("The uploaded file doesn't contain a supported video stream.");
  if (duration > 4 * 60 * 60) throw new Error("Videos longer than four hours aren't supported.");
  return { width: video.width, height: video.height, duration, hasAudio: Boolean(metadata.streams?.some(stream => stream.codec_type === "audio")) };
}
async function execute(job: RenderJob): Promise<void> {
  try {
    update(job, "processing", 1, "Reading your media and preparing the server render.");
    const source = await probeVideo(job);
    const [width, height] = outputDimensions(source.width, source.height, job.settings.aspect);
    const rate = job.settings.speed / 100;
    const outputDuration = source.duration / rate;
    const vf = [
      "setpts=" + Number(1 / rate).toFixed(5) + "*PTS",
      "scale=" + width + ":" + height + ":force_original_aspect_ratio=increase",
      "crop=" + width + ":" + height, "setsar=1", "fps=30",
      visualFilter(job.settings.preset), ...titleFilters(job.settings, job, height),
    ].filter(Boolean).join(",");
    const fontFile = process.env.REEDITX_FONT_PATH || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
    const hasTitle = Boolean(job.settings.title.trim() || job.settings.subtitle.trim());
    if (hasTitle) {
      try { await fs.access(fontFile); } catch { throw new Error("The render server is missing its title font. Ask the administrator to install DejaVu fonts."); }
      if (job.settings.title.trim()) await fs.writeFile(join(job.directory, "title.txt"), job.settings.title.replace(/[\r\n]+/g, " ").trim().slice(0, 90), "utf8");
      if (job.settings.subtitle.trim()) await fs.writeFile(join(job.directory, "subtitle.txt"), job.settings.subtitle.replace(/[\r\n]+/g, " ").trim().slice(0, 120), "utf8");
    }
    const args = ["-hide_banner", "-y", "-i", job.videoPath];
    if (job.audioPath) args.push("-stream_loop", "-1", "-i", job.audioPath);
    const graphs = ["[0:v:0]" + vf + "[vout]"];
    const audioRate = atempo(rate);
    const volume = (amount: number) => Math.max(0, Math.min(100, amount)) / 100;
    let hasOutputAudio = false;
    if (source.hasAudio && job.audioPath) {
      graphs.push("[0:a:0]volume=" + volume(job.settings.sourceVolume) + "," + audioRate + "[sourceaudio]");
      const music: string[] = ["volume=" + volume(job.settings.volume), audioRate];
      if (job.settings.fadeIn > 0) music.push("afade=t=in:st=0:d=" + job.settings.fadeIn);
      if (job.settings.fadeOut > 0 && outputDuration > job.settings.fadeOut) music.push("afade=t=out:st=" + Number(outputDuration - job.settings.fadeOut).toFixed(3) + ":d=" + job.settings.fadeOut);
      graphs.push("[1:a:0]" + music.join(",") + "[musicaudio]");
      graphs.push("[sourceaudio][musicaudio]amix=inputs=2:duration=longest:dropout_transition=2,apad[aout]");
      hasOutputAudio = true;
    } else if (source.hasAudio) {
      graphs.push("[0:a:0]volume=" + volume(job.settings.sourceVolume) + "," + audioRate + ",apad[aout]");
      hasOutputAudio = true;
    } else if (job.audioPath) {
      const music: string[] = ["volume=" + volume(job.settings.volume), audioRate];
      if (job.settings.fadeIn > 0) music.push("afade=t=in:st=0:d=" + job.settings.fadeIn);
      if (job.settings.fadeOut > 0 && outputDuration > job.settings.fadeOut) music.push("afade=t=out:st=" + Number(outputDuration - job.settings.fadeOut).toFixed(3) + ":d=" + job.settings.fadeOut);
      graphs.push("[1:a:0]" + music.join(",") + ",apad[aout]");
      hasOutputAudio = true;
    }
    args.push("-filter_complex", graphs.join(";"), "-map", "[vout]");
    if (hasOutputAudio) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
    else args.push("-an");
    args.push("-t", outputDuration.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-threads", "2", "-progress", "pipe:1", "-nostats", job.outputPath);
    await runFfmpeg(job, args, outputDuration);
    const details = await fs.stat(job.outputPath);
    if (details.size < 1024) throw new Error("The render returned an empty video file.");
    job.outputBytes = details.size;
    update(job, "complete", 100, "Render complete. Your video is ready to download.");
    scheduleRenderCleanup(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The render failed.";
    update(job, "failed", job.progress, message.slice(0, 400));
    scheduleRenderCleanup(job.id, 10 * 60 * 1000);
  }
}
function runFfmpeg(job: RenderJob, args: string[], duration: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const binary = process.env.FFMPEG_PATH || "ffmpeg";
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; let lastProgress = 0; let settled = false;
    const timeout = setTimeout(() => { child.kill("SIGKILL"); finish(new Error("The render exceeded the server time limit.")); }, Math.max(20 * 60 * 1000, duration * 2500));
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timeout);
      if (error) reject(error); else resolve();
    };
    child.stdout.on("data", chunk => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const match = line.match(/^out_time_(?:us|ms)=(\d+)/);
        if (match) {
          const seconds = Number(match[1]) / 1_000_000;
          const p = Math.min(98, 3 + seconds / Math.max(1, duration) * 94);
          if (p >= lastProgress + 1) {
            lastProgress = p;
            update(job, "processing", p, "Rendering video and mixing sound on the ReEditX server.");
          }
        }
      }
    });
    child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-8000); });
    child.once("error", error => finish(new Error("The server could not start FFmpeg. Check the render server installation.")));
    child.once("close", code => code === 0 ? finish() : finish(new Error(stderr.trim().split("\n").slice(-4).join("\n") || "FFmpeg render failed.")));
  });
}
function pumpQueue() {
  if (store.active >= MAX_ACTIVE) return;
  const id = store.queue.shift();
  if (!id) return;
  const job = store.jobs.get(id);
  if (!job || job.status !== "queued") { pumpQueue(); return; }
  store.active += 1;
  void execute(job).finally(() => { store.active = Math.max(0, store.active - 1); pumpQueue(); });
}
