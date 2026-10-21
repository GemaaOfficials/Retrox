import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PUBLIC_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5b3l4amFneWdsbmdybGJua3diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NDcxNjksImV4cCI6MjEwODEyMzE2OX0.TIqVaDVQLyrQaNR7_9t6GC3w7KsakGzCkixbjezIuI8";
const BUCKET = "reeditx-media";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_COMBINED_BYTES = 65 * 1024 * 1024;
const MAX_OPEN_JOBS = 16;
const JOB_TTL_MS = 3 * 60 * 60 * 1000;

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Required Supabase Edge Function secrets are missing.");
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-reeditx-job-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function jsonError(message: string, status: number, code: string) {
  return json({ error: message, code }, status);
}

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v", "mkv"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "opus", "flac", "webm", "mp4"]);
const ASPECTS = new Set(["original", "landscape", "portrait", "square"]);
const PRESETS = new Set(["none", "cinema", "mono", "dream", "neon"]);
const RHYTHMS = new Set(["steady", "punchy", "slow"]);
const rateBuckets = new Map<string, number[]>();

function cleanName(name: string) {
  return name.replace(/[\r\n\u0000-\u001f]/g, "").replace(/[\\/]/g, "_").slice(0, 180) || "media";
}

function extensionOf(file: File) {
  const name = cleanName(file.name).toLowerCase();
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
}

function mimeFor(ext: string, audio = false) {
  const types: Record<string, string> = audio ? {
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac",
    ogg: "audio/ogg", opus: "audio/opus", flac: "audio/flac", webm: "audio/webm", mp4: "audio/mp4",
  } : {
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    m4v: "video/x-m4v", mkv: "video/x-matroska",
  };
  return types[ext] || "application/octet-stream";
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number, integer = false) {
  const number = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new Error("One or more edit settings are outside the supported range.");
  }
  return number;
}

function normalizeSettings(value: unknown) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const preset = typeof raw.preset === "string" ? raw.preset : "cinema";
  const rhythm = typeof raw.rhythm === "string" ? raw.rhythm : "steady";
  const aspect = typeof raw.aspect === "string" ? raw.aspect : "original";
  if (!PRESETS.has(preset) || !RHYTHMS.has(rhythm) || !ASPECTS.has(aspect)) {
    throw new Error("An edit preset, rhythm, or aspect ratio is not supported.");
  }
  const cuts = Array.isArray(raw.cuts) ? raw.cuts : [];
  if (cuts.length > 120 || cuts.some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 8 * 60 * 60)) {
    throw new Error("The edit plan contains invalid cut markers.");
  }
  const cleanText = (input: unknown, max: number) => typeof input === "string"
    ? input.replace(/[\r\n\u0000-\u001f]/g, " ").trim().slice(0, max)
    : "";
  return {
    speed: boundedNumber(raw.speed, 1, 0.25, 2),
    volume: boundedNumber(raw.volume, 70, 0, 100, true),
    sourceVolume: boundedNumber(raw.sourceVolume, 85, 0, 100, true),
    fadeIn: boundedNumber(raw.fadeIn, 1, 0, 10),
    fadeOut: boundedNumber(raw.fadeOut, 2, 0, 10),
    aspect,
    preset,
    rhythm,
    title: cleanText(raw.title, 90),
    subtitle: cleanText(raw.subtitle, 120),
    animatedTitles: raw.animatedTitles !== false,
    useQuickCuts: raw.useQuickCuts === true,
    cuts: cuts as number[],
  };
}

async function hashToken(token: string) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

function sameHash(a: string, b: string) {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}

function requestIp(req: Request) {
  return (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim().slice(0, 100);
}

function allowSubmit(ip: string) {
  const now = Date.now();
  const recent = (rateBuckets.get(ip) || []).filter(time => now - time < 15 * 60 * 1000);
  if (recent.length >= 4) {
    rateBuckets.set(ip, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(ip, recent);
  if (rateBuckets.size > 2000) {
    for (const [key, values] of rateBuckets) {
      if (values.every(time => now - time >= 15 * 60 * 1000)) rateBuckets.delete(key);
    }
  }
  return true;
}

async function health() {
  const [heartbeat, openJobs] = await Promise.all([
    supabase.from("reeditx_worker_heartbeats").select("last_seen_at,active_jobs,queued_jobs").order("last_seen_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("reeditx_render_jobs").select("id", { count: "exact", head: true })
      .in("status", ["queued", "processing"]).gt("expires_at", new Date().toISOString()),
  ]);
  if (heartbeat.error || openJobs.error) {
    console.error("ReEditX Supabase health check failed:", heartbeat.error?.message || openJobs.error?.message);
    return json({ available: false, configured: true, message: "The Supabase render backend is not ready yet." }, 503);
  }
  const lastSeen = heartbeat.data?.last_seen_at ? Date.parse(heartbeat.data.last_seen_at) : 0;
  const workerOnline = Number.isFinite(lastSeen) && Date.now() - lastSeen < 8 * 60 * 1000;
  if (!workerOnline) {
    return json({ available: true, configured: true, workerOnline: false, queueBackend: "supabase-postgres", engine: "ffmpeg-github-actions", queueDepth: openJobs.count ?? 0, activeJobs: 0, message: "The Supabase queue is ready. Render jobs will wait for the scheduled FFmpeg runner to pick them up." });
  }
  return json({
    available: true,
    configured: true,
    workerOnline: true,
    queueBackend: "supabase-postgres",
    engine: "ffmpeg-github-actions",
    queueDepth: openJobs.count ?? 0,
    activeJobs: heartbeat.data?.active_jobs ?? 0,
    message: "ReEditX Supabase queue and FFmpeg worker are ready.",
  });
}

async function getAuthorizedJob(id: string, token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id) || token.length < 40 || token.length > 200) {
    return { job: null, status: 404 as const };
  }
  const { data, error } = await supabase.from("reeditx_render_jobs").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("Could not read render job:", error.message);
    return { job: null, status: 503 as const };
  }
  if (!data || !data.client_token_hash) return { job: null, status: 404 as const };
  if (!sameHash(data.client_token_hash, await hashToken(token))) return { job: null, status: 403 as const };
  return { job: data, status: 200 as const };
}

async function getStatus(id: string, token: string) {
  const { job, status } = await getAuthorizedJob(id, token);
  if (!job) return jsonError(status === 403 ? "This render token is not valid for that job." : status === 404 ? "Render job not found or expired." : "Could not read render status.", status, "JOB_LOOKUP_FAILED");
  return json({
    jobId: job.id,
    status: job.status === "processing" ? "running" : job.status,
    percent: job.progress,
    message: job.message,
    error: job.error_message,
    outputName: job.output_name,
  });
}

async function getDownload(id: string, token: string) {
  const { job, status } = await getAuthorizedJob(id, token);
  if (!job) return jsonError(status === 403 ? "This render token is not valid for that job." : status === 404 ? "Render job not found or expired." : "Could not read render status.", status, "JOB_LOOKUP_FAILED");
  if (job.status !== "complete" || !job.output_object_path) return jsonError("This render is not ready to download.", 409, "JOB_NOT_READY");
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(job.output_object_path, 600, { download: job.output_name || "ReEditX-remix.mp4" });
  if (error || !data?.signedUrl) {
    console.error("Could not sign ReEditX output URL:", error?.message);
    return jsonError("The output file could not be made available for download.", 502, "SIGNED_URL_FAILED");
  }
  return json({ downloadUrl: data.signedUrl, expiresIn: 600 });
}

async function submit(request: Request) {
  const ip = requestIp(request);
  if (!allowSubmit(ip)) return jsonError("This connection has submitted four renders within 15 minutes. Please wait before submitting another.", 429, "RATE_LIMITED");
  let form: FormData;
  try { form = await request.formData(); } catch { return jsonError("Could not read the multipart media upload.", 400, "INVALID_FORM"); }
  const video = form.get("video");
  const audio = form.get("audio");
  const settingsValue = form.get("settings");
  if (!(video instanceof File)) return jsonError("Select a video before starting the server render.", 400, "VIDEO_REQUIRED");
  const videoExt = extensionOf(video);
  if (!VIDEO_EXTENSIONS.has(videoExt)) return jsonError("Use MP4, MOV, WEBM, M4V, or MKV video files.", 415, "UNSUPPORTED_VIDEO");
  if (video.size < 1024 || video.size > MAX_FILE_BYTES) return jsonError("The video must be between 1 KB and 50 MB on this Supabase Free project.", 413, "VIDEO_SIZE_LIMIT");
  let audioFile: File | null = null;
  if (audio instanceof File && audio.size > 0) {
    const audioExt = extensionOf(audio);
    if (!AUDIO_EXTENSIONS.has(audioExt)) return jsonError("Use MP3, WAV, M4A, AAC, OGG, OPUS, FLAC, WEBM, or MP4 soundtrack files.", 415, "UNSUPPORTED_AUDIO");
    if (audio.size < 256 || audio.size > MAX_FILE_BYTES) return jsonError("The soundtrack must be between 256 bytes and 50 MB.", 413, "AUDIO_SIZE_LIMIT");
    audioFile = audio;
  }
  if (video.size + (audioFile?.size || 0) > MAX_COMBINED_BYTES) return jsonError("Keep the combined video and soundtrack under 65 MB for this edge upload.", 413, "COMBINED_SIZE_LIMIT");

  let settings: ReturnType<typeof normalizeSettings>;
  try {
    if (typeof settingsValue !== "string" || settingsValue.length > 16 * 1024) throw new Error("Missing or oversized edit settings.");
    settings = normalizeSettings(JSON.parse(settingsValue));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Editing settings are invalid.", 400, "INVALID_SETTINGS");
  }

  const { count, error: countError } = await supabase.from("reeditx_render_jobs").select("id", { count: "exact", head: true })
    .in("status", ["queued", "processing"]).gt("expires_at", new Date().toISOString());
  if (countError) {
    console.error("Could not count ReEditX jobs:", countError.message);
    return jsonError("The Supabase render queue is unavailable.", 503, "QUEUE_UNAVAILABLE");
  }
  if ((count ?? 0) >= MAX_OPEN_JOBS) return jsonError("The ReEditX render queue is full. Try again shortly.", 429, "QUEUE_FULL");

  const id = crypto.randomUUID();
  const clientToken = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const clientTokenHash = await hashToken(clientToken);
  const videoPath = "jobs/" + id + "/source-video." + videoExt;
  const audioPath = audioFile ? "jobs/" + id + "/soundtrack." + extensionOf(audioFile) : null;
  const outputPath = "jobs/" + id + "/ReEditX-remix.mp4";
  const uploaded: string[] = [];
  try {
    const { error: videoError } = await supabase.storage.from(BUCKET).upload(videoPath, video, {
      contentType: mimeFor(videoExt),
      upsert: false,
    });
    if (videoError) throw new Error("Video upload failed: " + videoError.message);
    uploaded.push(videoPath);

    if (audioFile && audioPath) {
      const { error: audioError } = await supabase.storage.from(BUCKET).upload(audioPath, audioFile, {
        contentType: mimeFor(extensionOf(audioFile), true),
        upsert: false,
      });
      if (audioError) throw new Error("Soundtrack upload failed: " + audioError.message);
      uploaded.push(audioPath);
    }

    const now = new Date().toISOString();
    const { error: insertError } = await supabase.from("reeditx_render_jobs").insert({
      id,
      status: "queued",
      progress: 0,
      message: "Uploaded securely to Supabase. Waiting for the FFmpeg worker.",
      source_video_path: videoPath,
      source_audio_path: audioPath,
      output_object_path: outputPath,
      settings,
      source_has_audio: false,
      output_name: "ReEditX-remix.mp4",
      client_token_hash: clientTokenHash,
      created_at: now,
      updated_at: now,
      expires_at: new Date(Date.now() + JOB_TTL_MS).toISOString(),
    });
    if (insertError) throw new Error("Could not add the render job to Supabase.");
    return json({
      jobId: id,
      clientToken,
      status: "queued",
      message: "Your upload is stored privately and the render job is queued.",
    }, 202);
  } catch (error) {
    if (uploaded.length) {
      const { error: cleanupError } = await supabase.storage.from(BUCKET).remove(uploaded);
      if (cleanupError) console.error("Could not remove an incomplete upload:", cleanupError.message);
    }
    console.error("ReEditX render submission failed:", error instanceof Error ? error.message : String(error));
    return jsonError(error instanceof Error ? error.message.slice(0, 300) : "Could not submit the render job.", 502, "SUBMIT_FAILED");
  }
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (!PUBLIC_ANON_KEY || request.headers.get("apikey") !== PUBLIC_ANON_KEY) {
    return jsonError("The ReEditX project API key is not valid.", 401, "INVALID_API_KEY");
  }
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "submit";
  try {
    if (request.method === "GET" && action === "health") return await health();
    if (request.method === "GET" && action === "status") {
      const token = request.headers.get("x-reeditx-job-token") || url.searchParams.get("token") || "";
      return await getStatus(url.searchParams.get("id") || "", token);
    }
    if (request.method === "GET" && action === "download") {
      const token = request.headers.get("x-reeditx-job-token") || url.searchParams.get("token") || "";
      return await getDownload(url.searchParams.get("id") || "", token);
    }
    if (request.method === "POST" && action === "submit") return await submit(request);
    return jsonError("Unsupported ReEditX render API action.", 404, "ACTION_NOT_FOUND");
  } catch (error) {
    console.error("Unhandled ReEditX Edge Function error:", error instanceof Error ? error.message : String(error));
    return jsonError("The ReEditX rendering API encountered an unexpected error.", 500, "EDGE_FUNCTION_ERROR");
  }
});
