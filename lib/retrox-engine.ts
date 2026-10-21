import { FFmpeg } from "@ffmpeg/ffmpeg";
import type { ProjectSettings } from "@/lib/project-db";
import type { RetroxLookRecipe, RetroxStyleProfile } from "@/lib/retrox-recipes";

export type RetroxProgress = (percent: number, detail: string) => void;

interface RenderOptions {
  videoFile: File;
  audioFile: File | null;
  settings: ProjectSettings;
  duration: number;
  sourceWidth: number;
  sourceHeight: number;
  sceneCuts: number[];
  profile: RetroxStyleProfile;
  onProgress?: RetroxProgress;
}

type AudioMode = "mix" | "music" | "source" | "none";

const fixed = (number: number, digits = 3) => Number.isFinite(number) ? number.toFixed(digits) : "0";
const extension = (name: string, fallback: string) => {
  const match = name.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return match && ["mp4", "mov", "m4v", "webm", "mkv", "avi", "mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(match[1]) ? match[1] : fallback;
};
const stem = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "video";

function atempo(speed: number): string {
  let rest = speed;
  const filters: string[] = [];
  while (rest < 0.5) { filters.push("atempo=0.5"); rest /= 0.5; }
  while (rest > 2) { filters.push("atempo=2"); rest /= 2; }
  filters.push("atempo=" + fixed(rest));
  return filters.join(",");
}

function outputSize(settings: ProjectSettings, sourceWidth: number, sourceHeight: number) {
  const sw = Math.max(1, sourceWidth || 1280);
  const sh = Math.max(1, sourceHeight || 720);
  if (settings.aspect === "landscape") return { width: 1280, height: 720 };
  if (settings.aspect === "portrait") return { width: 720, height: 1280 };
  if (settings.aspect === "square") return { width: 1080, height: 1080 };
  const width = Math.min(1920, sw);
  return { width, height: Math.max(2, Math.round(width * sh / sw / 2) * 2) };
}

function lookFilters(recipe: RetroxLookRecipe): string[] {
  const filters = [
    "eq=brightness=" + fixed(recipe.brightness) + ":contrast=" + fixed(recipe.contrast) + ":saturation=" + fixed(recipe.monochrome ? 0 : recipe.saturation),
  ];
  if (Math.abs(recipe.red) + Math.abs(recipe.green) + Math.abs(recipe.blue) > 0.002) {
    filters.push("colorbalance=rs=" + fixed(recipe.red) + ":gs=" + fixed(recipe.green) + ":bs=" + fixed(recipe.blue));
  }
  if (recipe.vignette > 0.05) {
    const denominator = Math.max(3, Math.min(8, Math.round(7 - recipe.vignette * 7)));
    filters.push("vignette=PI/" + denominator);
  }
  if (recipe.grain > 0) filters.push("noise=alls=" + Math.round(recipe.grain) + ":allf=t+u");
  return filters;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.length > 0 && lines.join(" ").length < text.trim().length) {
    let finalLine = lines[maxLines - 1];
    while (finalLine.length > 3 && ctx.measureText(finalLine + "…").width > maxWidth) finalLine = finalLine.slice(0, -1);
    lines[maxLines - 1] = finalLine.replace(/[ .]+$/, "") + "…";
  }
  return lines;
}

async function titleOverlay(width: number, height: number, settings: ProjectSettings): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Retrox couldn't prepare the title overlay.");
  ctx.clearRect(0, 0, width, height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.82)";
  ctx.shadowBlur = Math.max(8, width * 0.012);
  ctx.lineJoin = "round";
  const maxWidth = width * 0.84;
  const titleFontSize = Math.max(24, Math.round(height * 0.064));
  ctx.font = "700 " + titleFontSize + "px system-ui, Arial, sans-serif";
  const titleLines = wrapText(ctx, settings.title || settings.subtitle, maxWidth, 2);
  const subtitleFontSize = Math.max(15, Math.round(height * 0.026));
  ctx.font = "600 " + subtitleFontSize + "px system-ui, Arial, sans-serif";
  const subtitleLines = settings.title && settings.subtitle ? wrapText(ctx, settings.subtitle, maxWidth, 2) : [];
  const titleLineHeight = titleFontSize * 1.12;
  const subtitleLineHeight = subtitleFontSize * 1.3;
  const titleHeight = titleLines.length * titleLineHeight;
  const subtitleHeight = subtitleLines.length * subtitleLineHeight;
  const gap = subtitleLines.length ? height * 0.018 : 0;
  let y = height * 0.75 - (titleHeight + subtitleHeight + gap) / 2;
  ctx.font = "700 " + titleFontSize + "px system-ui, Arial, sans-serif";
  for (const line of titleLines) {
    ctx.lineWidth = Math.max(2, width * 0.0025);
    ctx.strokeStyle = "rgba(0,0,0,0.86)";
    ctx.fillStyle = "#ffffff";
    ctx.strokeText(line, width / 2, y);
    ctx.fillText(line, width / 2, y);
    y += titleLineHeight;
  }
  if (subtitleLines.length) {
    y += gap;
    ctx.font = "600 " + subtitleFontSize + "px system-ui, Arial, sans-serif";
    ctx.fillStyle = "#d9fff7";
    for (const line of subtitleLines) {
      ctx.lineWidth = Math.max(1, width * 0.0015);
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText(line, width / 2, y);
      ctx.fillText(line, width / 2, y);
      y += subtitleLineHeight;
    }
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Retrox couldn't create the title overlay image.")), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

function buildVideoGraph(
  settings: ProjectSettings, profile: RetroxStyleProfile, width: number, height: number,
  sceneCuts: number[], overlayIndex: number, speed: number,
) {
  const videoFilters: string[] = [];
  if (settings.useQuickCuts && settings.rhythm === "punchy" && sceneCuts.length) {
    const removed = sceneCuts
      .filter(cut => Number.isFinite(cut) && cut > 0.2)
      .slice(0, 80)
      .map(cut => "between(t\\," + fixed(cut) + "\\," + fixed(cut + 0.14) + ")")
      .join("+");
    if (removed) videoFilters.push("select='not(" + removed + ")'");
    videoFilters.push("setpts=N/(30*TB*" + fixed(speed) + ")");
  } else {
    videoFilters.push("setpts=(PTS-STARTPTS)/" + fixed(speed));
  }
  videoFilters.push(
    "scale=" + width + ":" + height + ":force_original_aspect_ratio=decrease",
    "pad=" + width + ":" + height + ":(ow-iw)/2:(oh-ih)/2:color=black",
    ...lookFilters(profile.recipe),
    "fps=30",
  );
  const graph: string[] = [];
  if (overlayIndex >= 0) {
    graph.push("[0:v]" + videoFilters.join(",") + "[vbase]");
    const fade = settings.animatedTitles ? ",fade=t=in:st=0:d=0.7:alpha=1" : "";
    graph.push("[" + overlayIndex + ":v]format=rgba" + fade + "[title]");
    graph.push("[vbase][title]overlay=0:0:enable='lt(t,4)':eof_action=pass,format=yuv420p[vout]");
  } else {
    graph.push("[0:v]" + videoFilters.join(",") + ",format=yuv420p[vout]");
  }
  return graph;
}

function audioGraph(mode: AudioMode, settings: ProjectSettings, outputDuration: number): string[] {
  const graph: string[] = [];
  const speedFilter = atempo(Math.min(2, Math.max(0.25, settings.speed / 100)));
  const fades: string[] = [];
  if (settings.fadeIn > 0.01) fades.push("afade=t=in:st=0:d=" + fixed(Math.min(settings.fadeIn, outputDuration)));
  if (settings.fadeOut > 0.01 && outputDuration > settings.fadeOut) {
    fades.push("afade=t=out:st=" + fixed(outputDuration - settings.fadeOut) + ":d=" + fixed(settings.fadeOut));
  }
  const musicChain = ["volume=" + fixed(settings.volume / 100), ...fades, "apad", "atrim=duration=" + fixed(outputDuration), "asetpts=PTS-STARTPTS"].join(",");
  if (mode === "mix") {
    graph.push("[0:a:0]volume=" + fixed(settings.sourceVolume / 100) + "," + speedFilter + "[retrox_source_audio]");
    graph.push("[1:a:0]" + musicChain + "[retrox_music_audio]");
    graph.push("[retrox_source_audio][retrox_music_audio]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]");
  } else if (mode === "music") {
    graph.push("[1:a:0]" + musicChain + "[aout]");
  } else if (mode === "source") {
    graph.push("[0:a:0]volume=" + fixed(settings.sourceVolume / 100) + "," + speedFilter + ",apad,atrim=duration=" + fixed(outputDuration) + ",asetpts=PTS-STARTPTS[aout]");
  }
  return graph;
}

async function removeFile(ffmpeg: FFmpeg, path: string) {
  try { await ffmpeg.deleteFile(path); } catch { /* It may not have been created or may already be gone. */ }
}

export async function renderRetrox(options: RenderOptions): Promise<{ blob: Blob; fileName: string }> {
  const {
    videoFile, audioFile, settings, duration, sourceWidth, sourceHeight, sceneCuts, profile, onProgress,
  } = options;
  if (typeof window === "undefined") throw new Error("Retrox rendering is available inside the app.");
  if (!videoFile || videoFile.size === 0) throw new Error("Choose a video before exporting.");
  if (videoFile.size > 500 * 1024 * 1024 || (audioFile && audioFile.size > 120 * 1024 * 1024)) {
    throw new Error("This file is too large for the local WebAssembly engine's memory budget. Try a smaller source clip or use the WebM fallback.");
  }

  const ffmpeg = new FFmpeg();
  const logBuffer: string[] = [];
  ffmpeg.on("log", ({ message }) => {
    if (message) {
      logBuffer.push(message);
      if (logBuffer.length > 30) logBuffer.shift();
    }
  });
  ffmpeg.on("progress", ({ progress }) => {
    if (typeof progress === "number" && Number.isFinite(progress)) {
      onProgress?.(Math.max(8, Math.min(95, 8 + progress * 87)), "Retrox is rendering and encoding your video on this device…");
    }
  });

  const suffix = Date.now().toString(36);
  const inputVideo = "retrox-input-" + suffix + "." + extension(videoFile.name, "mp4");
  const inputAudio = "retrox-audio-" + suffix + "." + (audioFile ? extension(audioFile.name, "mp3") : "mp3");
  const titleFile = "retrox-title-" + suffix + ".png";
  const outputFile = "retrox-export-" + suffix + ".mp4";

  try {
    onProgress?.(3, "Loading the bundled Retrox FFmpeg engine…");
    const coreURL = new URL("/retrox/ffmpeg-core.js", window.location.href).href;
    const wasmURL = new URL("/retrox/ffmpeg-core.wasm", window.location.href).href;
    await ffmpeg.load({ coreURL, wasmURL });
    onProgress?.(8, "The Retrox engine is ready. Preparing local media…");
    await ffmpeg.writeFile(inputVideo, new Uint8Array(await videoFile.arrayBuffer()));
    if (audioFile) await ffmpeg.writeFile(inputAudio, new Uint8Array(await audioFile.arrayBuffer()));

    const { width, height } = outputSize(settings, sourceWidth, sourceHeight);
    const wantsTitle = Boolean(settings.title.trim() || settings.subtitle.trim());
    if (wantsTitle) {
      await ffmpeg.writeFile(titleFile, await titleOverlay(width, height, settings));
    }
    const speed = Math.min(2, Math.max(0.25, settings.speed / 100));
    const outputDuration = Math.min(3600, Math.max(0.1, (Number.isFinite(duration) && duration > 0 ? duration : 30) / speed));
    const attempts: AudioMode[] = audioFile ? ["mix", "music"] : ["source", "none"];
    let success = false;
    for (const mode of attempts) {
      await removeFile(ffmpeg, outputFile);
      const overlayIndex = wantsTitle ? (audioFile ? 2 : 1) : -1;
      const graph = buildVideoGraph(settings, profile, width, height, sceneCuts, overlayIndex, speed);
      if (mode !== "none") graph.push(...audioGraph(mode, settings, outputDuration));
      const args = ["-hide_banner", "-y", "-i", inputVideo];
      if (audioFile) args.push("-i", inputAudio);
      if (wantsTitle) args.push("-loop", "1", "-framerate", "30", "-i", titleFile);
      args.push("-filter_complex", graph.join(";"), "-map", "[vout]");
      if (mode === "none") {
        args.push("-an");
      } else {
        args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
      }
      args.push(
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-threads", "1", "-t", fixed(outputDuration, 2), "-shortest", outputFile,
      );
      onProgress?.(10, mode === "mix" ? "Mixing your soundtrack with the original audio…" : mode === "music" ? "Finishing with the added soundtrack…" : mode === "source" ? "Processing the original audio…" : "Finishing the video-only fallback…");
      const exitCode = await ffmpeg.exec(args);
      if (exitCode === 0) { success = true; break; }
      if (mode === "none") break;
    }
    if (!success) {
      throw new Error("Retrox couldn't encode this file locally. Check that it is a supported video format and that your device has enough free memory, then try the WebM fallback.");
    }
    onProgress?.(97, "Reading the completed MP4 from local engine memory…");
    const data = await ffmpeg.readFile(outputFile);
    if (typeof data === "string") throw new Error("Retrox returned an invalid MP4 result.");
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    const blob = new Blob([bytes.buffer], { type: "video/mp4" });
    if (!blob.size) throw new Error("Retrox created an empty output file.");
    onProgress?.(100, "Retrox finished the MP4. The download is ready.");
    const fileName = "ReEditX-" + stem(videoFile.name) + "-Retrox.mp4";
    return { blob, fileName };
  } finally {
    await removeFile(ffmpeg, inputVideo);
    await removeFile(ffmpeg, inputAudio);
    await removeFile(ffmpeg, titleFile);
    await removeFile(ffmpeg, outputFile);
    ffmpeg.terminate();
  }
}
