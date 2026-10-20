"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, AudioLines, Check, ChevronDown, Clapperboard, Download, Film,
  Layers3, LoaderCircle, Music2, Pause, Play, Plus, RefreshCw, Scissors,
  ShieldCheck, SlidersHorizontal, Sparkles, Upload, WandSparkles, X,
} from "lucide-react";
import { clearProject, loadProject, saveProject, type Aspect, type FilterPreset, type ProjectSettings, type Rhythm } from "@/lib/project-db";

type Scene = { id: number; start: number; end: number; duration: number; label: string };
type Progress = { percent: number; title: string; detail: string };

const defaults: ProjectSettings = {
  title: "", subtitle: "", volume: 70, sourceVolume: 85, speed: 100, fadeIn: 1, fadeOut: 2,
  aspect: "original", preset: "cinema", rhythm: "steady", animatedTitles: true, useQuickCuts: false,
};
const filters: Record<FilterPreset, string> = {
  none: "none", cinema: "contrast(1.12) saturate(1.16) brightness(.92)",
  mono: "grayscale(1) contrast(1.12)", dream: "saturate(1.28) brightness(1.07)",
  neon: "saturate(1.6) contrast(1.12)",
};
const presetInfo: { id: FilterPreset; label: string; note: string }[] = [
  { id: "cinema", label: "Cinema", note: "Film contrast" }, { id: "neon", label: "Neon", note: "Colour punch" },
  { id: "dream", label: "Dream", note: "Soft glow" }, { id: "mono", label: "Mono", note: "Black & white" },
  { id: "none", label: "Original", note: "No filter" },
];
const fmt = (n: number) => {
  const safe = Number.isFinite(n) && n > 0 ? n : 0;
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
};
const niceSize = (n: number) => n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

async function detectSceneChanges(url: string, duration: number, update: (value: number) => void): Promise<number[]> {
  if (duration < 3) return [];
  const source = document.createElement("video");
  source.preload = "auto"; source.muted = true; source.playsInline = true; source.src = url;
  await new Promise<void>((resolve, reject) => {
    source.onloadeddata = () => resolve();
    source.onerror = () => reject(new Error("This browser cannot analyse the uploaded video format."));
    window.setTimeout(() => reject(new Error("Timed out while reading the video frames.")), 20000);
  });
  const canvas = document.createElement("canvas"); canvas.width = 36; canvas.height = 20;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const samples = Math.min(72, Math.max(8, Math.floor(duration / 1.2)));
  let previous: Uint8ClampedArray | null = null;
  const changes: number[] = [];
  try {
    for (let i = 0; i < samples; i++) {
      const time = Math.min(Math.max(.05, duration - .08), i * (duration / samples));
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 2500);
        source.onseeked = () => { window.clearTimeout(timer); resolve(); };
        try { source.currentTime = time; } catch { window.clearTimeout(timer); resolve(); }
      });
      try { ctx.drawImage(source, 0, 0, canvas.width, canvas.height); } catch { update((i + 1) / samples); continue; }
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const luma = new Uint8ClampedArray(canvas.width * canvas.height);
      for (let p = 0, j = 0; p < data.length; p += 4, j++) luma[j] = (data[p] * 3 + data[p + 1] * 6 + data[p + 2]) / 10;
      if (previous) {
        let sum = 0; for (let j = 0; j < luma.length; j++) sum += Math.abs(luma[j] - previous[j]);
        const difference = sum / luma.length;
        if (difference > 34 && time > .75 && (changes.length === 0 || time - changes[changes.length - 1] > 1.25)) changes.push(Number(time.toFixed(2)));
      }
      previous = luma; update((i + 1) / samples);
    }
  } finally { source.removeAttribute("src"); source.load(); }
  return changes;
}

export default function Studio() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const musicPreviewRef = useRef<HTMLAudioElement>(null);
  const frameRef = useRef<number | null>(null);
  const cutsRef = useRef<number[]>([]);
  const videoUrlRef = useRef("");
  const audioUrlRef = useRef("");
  const settingsRef = useRef<ProjectSettings>(defaults);
  const [settings, setSettings] = useState<ProjectSettings>(defaults);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [resolution, setResolution] = useState("");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [sceneCuts, setSceneCuts] = useState<number[]>([]);
  const [inspecting, setInspecting] = useState(false);
  const [inspectProgress, setInspectProgress] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [saved, setSaved] = useState<"saving" | "saved" | "error">("saved");
  const [restored, setRestored] = useState(false);
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<Progress>({ percent: 0, title: "", detail: "" });
  const [activePanel, setActivePanel] = useState<"look" | "sound" | "text">("look");
  const [serverStatus, setServerStatus] = useState<"checking" | "online" | "offline">("checking");
  const [planLabel, setPlanLabel] = useState("READY TO CREATE");
  const [showScenes, setShowScenes] = useState(true);
  const [titleVisible, setTitleVisible] = useState(true);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { cutsRef.current = sceneCuts; }, [sceneCuts]);

  useEffect(() => {
    let mounted = true;
    fetch("/api/health").then(r => r.ok ? r.json() : Promise.reject()).then(() => { if (mounted) setServerStatus("online"); }).catch(() => { if (mounted) setServerStatus("offline"); });
    loadProject().then(project => {
      if (!mounted || !project) { setRestored(true); return; }
      setSettings(project.settings ?? defaults);
      if (project.videoBlob) {
        const file = new File([project.videoBlob], project.videoName || "restored-video.mp4", { type: project.videoBlob.type || "video/mp4" });
        setVideoFile(file); setVideoUrl(URL.createObjectURL(file));
      }
      if (project.audioBlob) {
        const file = new File([project.audioBlob], project.audioName || "restored-audio.mp3", { type: project.audioBlob.type || "audio/mpeg" });
        setAudioFile(file); setAudioUrl(URL.createObjectURL(file));
      }
      setNotice("Your last project was restored from this browser."); setRestored(true);
    }).catch(() => setRestored(true));
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!restored) return;
    setSaved("saving");
    const timer = window.setTimeout(async () => {
      try {
        await saveProject({ id: "latest", updatedAt: Date.now(), settings, videoBlob: videoFile ?? undefined, videoName: videoFile?.name, audioBlob: audioFile ?? undefined, audioName: audioFile?.name });
        setSaved("saved");
      } catch {
        setSaved("error");
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [settings, videoFile, audioFile, restored]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = settings.speed / 100;
    video.volume = settings.sourceVolume / 100;
    video.style.filter = filters[settings.preset];
  }, [settings.speed, settings.sourceVolume, settings.preset, videoUrl]);

  useEffect(() => { videoUrlRef.current = videoUrl; }, [videoUrl]);
  useEffect(() => { audioUrlRef.current = audioUrl; }, [audioUrl]);
  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  const patch = useCallback(<K extends keyof ProjectSettings>(key: K, value: ProjectSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const inspect = useCallback(async (url: string, mediaDuration: number, width: number, height: number) => {
    setInspecting(true); setInspectProgress(0); setPlanLabel("INSPECTING FRAMES");
    setResolution(`${width} × ${height}`); setDuration(mediaDuration);
    try {
      const response = await fetch("/api/edit-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ duration: mediaDuration, rhythm: settingsRef.current.rhythm, preset: settingsRef.current.preset }) });
      const data = response.ok ? await response.json() : null;
      if (data?.scenes) setScenes(data.scenes as Scene[]);
    } catch { /* Offline fallback: keep the editor usable. */ }
    let detected: number[] = [];
    try {
      detected = await detectSceneChanges(url, mediaDuration, setInspectProgress);
    } catch {
      detected = Array.from({ length: Math.min(8, Math.max(0, Math.floor(mediaDuration / 7))) }, (_, i) => Number(((i + 1) * mediaDuration / (Math.min(8, Math.max(1, Math.floor(mediaDuration / 7))) + 1)).toFixed(2)));
      setInspectProgress(1);
    }
    setSceneCuts(detected);
    setInspecting(false); setPlanLabel("FOOTAGE ANALYSED");
    setNotice(`Inspection complete · ${detected.length} possible scene change${detected.length === 1 ? "" : "s"} found.`);
  }, []);

  const onVideo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    if (!file.type.startsWith("video/")) { setNotice("Please choose a video file."); return; }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(file); setVideoFile(file); setVideoUrl(url);
    setDuration(0); setSceneCuts([]); setScenes([]); setInspecting(true); setInspectProgress(0);
    setPlanLabel("LOADING FOOTAGE"); setNotice("Video loaded locally. Reading metadata and sampling frames…");
  };
  const onAudio = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    if (!file.type.startsWith("audio/")) { setNotice("Please choose an audio file, such as MP3, WAV or M4A."); return; }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioFile(file); setAudioUrl(URL.createObjectURL(file)); setNotice("Soundtrack added. It will be mixed into the exported edit.");
  };

  const updateFromMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = event.currentTarget;
    if (!videoUrl || !Number.isFinite(v.duration) || v.duration <= 0 || v.videoWidth === 0) return;
    if (Math.abs(v.duration - duration) < .01 && resolution) return;
    void inspect(videoUrl, v.duration, v.videoWidth, v.videoHeight);
  };

  const togglePlay = async () => {
    const video = videoRef.current; if (!video) return;
    if (video.paused) { try { await video.play(); setPreviewPlaying(true); } catch { setNotice("This file could not be played in your browser. Try MP4 (H.264) or WebM."); } }
    else { video.pause(); setPreviewPlaying(false); }
  };

  const reset = async () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.removeAttribute("src"); videoRef.current.load(); }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setVideoUrl(""); setAudioUrl(""); setVideoFile(null); setAudioFile(null); setDuration(0); setResolution(""); setSceneCuts([]); setScenes([]);
    setInspecting(false); setPreviewPlaying(false); setPlanLabel("READY TO CREATE"); setProgress({ percent: 0, title: "", detail: "" });
    try { await clearProject(); setSaved("saved"); } catch { setSaved("error"); }
    setNotice("Workspace cleared. Upload a new video when you are ready.");
  };

  const exportRemix = async () => {
    const video = videoRef.current;
    if (!video || !videoFile || exporting) return;
    if (!("MediaRecorder" in window) || !("captureStream" in HTMLCanvasElement.prototype)) { setNotice("Your browser lacks canvas recording support. Please use an up-to-date desktop Chrome or Edge."); return; }
    setExporting(true); setNotice(""); setPlanLabel("RENDERING LOCALLY");
    setProgress({ percent: 0, title: "Preparing the remix", detail: "Building the live render pipeline…" });
    let recorder: MediaRecorder | null = null; let audioContext: AudioContext | null = null; let soundtrack: HTMLAudioElement | null = null; let raf = 0; let stopped = false;
    try {
      video.pause(); video.currentTime = 0; video.playbackRate = settings.speed / 100; video.volume = settings.sourceVolume / 100;
      const sourceWidth = video.videoWidth || 1280, sourceHeight = video.videoHeight || 720;
      let width = Math.min(1920, sourceWidth), height = Math.round(width * sourceHeight / sourceWidth);
      if (settings.aspect === "landscape") { width = 1280; height = 720; }
      if (settings.aspect === "square") { width = height = 1080; }
      if (settings.aspect === "portrait") { width = 720; height = 1280; }
      if (settings.aspect !== "original") { width = Math.min(width, settings.aspect === "portrait" ? 720 : 1280); if (settings.aspect === "square") width = height = 1080; }
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Could not start the video render canvas.");
      const stream = canvas.captureStream(30);
      const videoCapture = (video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream });
      const originalStream = videoCapture.captureStream?.() ?? videoCapture.mozCaptureStream?.();
      originalStream?.getAudioTracks().forEach(track => stream.addTrack(track));
      audioContext = new AudioContext();
      if (audioUrl && audioFile) {
        soundtrack = new Audio(audioUrl); soundtrack.preload = "auto";
        const source = audioContext.createMediaElementSource(soundtrack);
        const gain = audioContext.createGain(); const volume = settings.volume / 100;
        gain.gain.setValueAtTime(0, audioContext.currentTime);
        gain.gain.linearRampToValueAtTime(volume, audioContext.currentTime + Math.max(.05, settings.fadeIn));
        if (settings.fadeOut > 0 && duration > settings.fadeOut) {
          gain.gain.setValueAtTime(volume, audioContext.currentTime + Math.max(0, duration / (settings.speed / 100) - settings.fadeOut));
          gain.gain.linearRampToValueAtTime(0, audioContext.currentTime + duration / (settings.speed / 100));
        }
        source.connect(gain); gain.connect(audioContext.destination);
        const musicStream = audioContext.createMediaStreamDestination();
        gain.connect(musicStream); musicStream.stream.getAudioTracks().forEach(track => stream.addTrack(track));
      }
      const supported = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(type => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, supported ? { mimeType: supported, videoBitsPerSecond: 7_000_000 } : { videoBitsPerSecond: 7_000_000 });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      const completed = new Promise<void>((resolve, reject) => { if (!recorder) return reject(new Error("Recorder could not be created.")); recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error("Browser recording failed.")); });
      let lastProgressAt = 0;
      const drawFrame = () => {
        if (stopped) return;
        const time = video.currentTime;
        ctx.fillStyle = "#030308"; ctx.fillRect(0, 0, width, height);
        ctx.save(); ctx.filter = filters[settingsRef.current.preset];
        const scale = Math.max(width / sourceWidth, height / sourceHeight);
        const drawW = sourceWidth * scale, drawH = sourceHeight * scale;
        ctx.drawImage(video, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
        ctx.restore();
        const nearestCut = cutsRef.current.some(cut => Math.abs(cut - time) < .055);
        if (settingsRef.current.rhythm === "punchy" && nearestCut && settingsRef.current.useQuickCuts) { ctx.fillStyle = "rgba(255,255,255,.24)"; ctx.fillRect(0, 0, width, height); }
        if (titleVisible && (settingsRef.current.title || settingsRef.current.subtitle)) {
          const s = settingsRef.current; const alpha = s.animatedTitles ? Math.min(1, Math.max(0, time * 3.8)) : 1;
          const lift = s.animatedTitles ? Math.max(0, 1 - time * 3.8) * 28 : 0;
          ctx.save(); ctx.globalAlpha = alpha; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          const titleSize = Math.max(22, Math.round(width * .052)); const subSize = Math.max(12, Math.round(width * .021));
          ctx.shadowColor = "rgba(0,0,0,.8)"; ctx.shadowBlur = 20;
          if (s.title) { ctx.font = `800 ${titleSize}px system-ui, sans-serif`; ctx.lineWidth = Math.max(2, width * .0025); ctx.strokeStyle = "rgba(5,5,12,.75)"; ctx.strokeText(s.title.slice(0, 90), width / 2, height * .78 + lift); ctx.fillStyle = "#fff"; ctx.fillText(s.title.slice(0, 90), width / 2, height * .78 + lift); }
          if (s.subtitle) { ctx.font = `500 ${subSize}px system-ui, sans-serif`; ctx.fillStyle = "#b5fff6"; ctx.fillText(s.subtitle.slice(0, 120), width / 2, height * .85 + lift); }
          ctx.restore();
        }
        const now = performance.now();
        if (now - lastProgressAt > 220 || time <= 0.01) {
          lastProgressAt = now;
          setProgress({ percent: Math.min(96, Math.round(time / Math.max(1, duration) * 96)), title: "Rendering in real time", detail: audioUrl ? "Compositing video, titles, visual treatment and soundtrack…" : "Compositing video, titles and visual treatment…" });
        }
        raf = requestAnimationFrame(drawFrame);
      };
      if (audioContext.state === "suspended") await audioContext.resume();
      if (soundtrack) { soundtrack.currentTime = 0; await soundtrack.play().catch(() => undefined); }
      recorder.start(250); drawFrame();
      await video.play();
      await new Promise<void>((resolve, reject) => {
        const done = () => resolve();
        video.addEventListener("ended", done, { once: true });
        const check = () => { if (!video.paused && !video.ended) window.setTimeout(check, 250); else if (video.ended) resolve(); };
        check();
        window.setTimeout(() => { if (!video.ended && video.paused) reject(new Error("Playback paused during export. Keep the tab open and retry.")); }, Math.max(20_000, duration / (settings.speed / 100) * 1000 + 15_000));
      });
      stopped = true; cancelAnimationFrame(raf); recorder.stop(); await completed;
      const type = recorder.mimeType || "video/webm"; const blob = new Blob(chunks, { type });
      const name = (videoFile.name.replace(/.[^.]+$/, "") || "reeditx") + "-remix.webm";
      const downloadUrl = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = downloadUrl; link.download = name; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
      setProgress({ percent: 100, title: "Your remix is ready", detail: `${niceSize(blob.size)} · downloaded as WebM · rendered on this device` });
      setNotice("Export complete — check your Downloads folder."); setPlanLabel("EXPORT COMPLETE");
    } catch (error) {
      setProgress({ percent: 0, title: "Export did not finish", detail: error instanceof Error ? error.message : "Try another browser-supported video format." });
      setNotice(error instanceof Error ? error.message : "Export failed. Please try again."); setPlanLabel("EXPORT INTERRUPTED");
    } finally {
      stopped = true; if (raf) cancelAnimationFrame(raf); if (video) { video.pause(); video.playbackRate = settings.speed / 100; }
      if (soundtrack) { soundtrack.pause(); soundtrack.src = ""; }
      if (audioContext) await audioContext.close().catch(() => undefined);
      setPreviewPlaying(false); setExporting(false);
    }
  };

  const removeAudio = () => { if (audioUrl) URL.revokeObjectURL(audioUrl); setAudioUrl(""); setAudioFile(null); setNotice("Soundtrack removed."); };
  const moveToMarker = (time: number) => { if (videoRef.current) { videoRef.current.currentTime = time; videoRef.current.pause(); setPreviewPlaying(false); } };
  const pct = duration ? Math.min(100, Math.max(0, ((videoRef.current?.currentTime || 0) / duration) * 100)) : 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ReEditX home"><span className="brand-mark"><Clapperboard size={21} strokeWidth={2.4} /></span><span><strong>ReEdit<span>X</span></strong><small>YOUR FOOTAGE. YOUR RULES.</small></span></a>
        <div className="topbar-right">
          <span className={serverStatus === "online" ? "api-state online" : "api-state"}><i />{serverStatus === "checking" ? "CONNECTING" : serverStatus === "online" ? "LOCAL ENGINE ONLINE" : "OFFLINE MODE"}</span>
          <div className="save-state">{saved === "saving" ? <LoaderCircle size={14} className="spin" /> : saved === "error" ? <X size={14} /> : <Check size={14} />}{saved === "saving" ? "Saving project" : saved === "error" ? "Save issue" : "Autosaved locally"}</div>
        </div>
      </header>

      <section className="hero-row">
        <div><p className="overline"><Sparkles size={13} /> CREATIVE ENGINE / 001</p><h1>Make every frame<br /><em>feel something.</em></h1><p className="hero-copy">A hands-on remix system for music-driven edits. Import footage, add your sound, then watch ReEditX bring the cut to life — all on your device.</p></div>
        <div className="hero-side"><div className="hero-orb"><div className="orb-core"><WandSparkles size={30} /></div><span className="orb-ring ring-a" /><span className="orb-ring ring-b" /></div><div className="privacy-chip"><ShieldCheck size={15} /> NO LOGIN · LOCAL MEDIA</div></div>
      </section>

      <nav className="steps" aria-label="Editing workflow">
        {[["01","Import footage"],["02","Inspect frames"],["03","Add soundtrack"],["04","Remix & export"]].map(([num,label], i) => <div className={((!videoFile && i===0) || (videoFile && inspecting && i===1) || (videoFile && !inspecting && !audioFile && i===2) || (videoFile && audioFile && i===3)) ? "step active" : "step"} key={num}><b>{num}</b><span>{label}</span></div>)}
      </nav>

      <div className="workspace">
        <section className="main-column">
          <div className="panel monitor-panel">
            <div className="panel-head"><div><span className="eyebrow">01 / LIVE MONITOR</span><h2>Footage preview</h2></div><span className={inspecting ? "status-pill busy-pill" : "status-pill"}><i />{inspecting ? "INSPECTING" : videoFile ? "SOURCE READY" : "AWAITING MEDIA"}</span></div>
            <div className="video-stage">
              {videoUrl ? <video ref={videoRef} key={videoUrl} src={videoUrl} playsInline controls onLoadedMetadata={updateFromMetadata} onPlay={() => setPreviewPlaying(true)} onPause={() => setPreviewPlaying(false)} onTimeUpdate={() => { if (videoRef.current) setPreviewPlaying(!videoRef.current.paused); }} style={{ filter: filters[settings.preset] }} /> :
                <div className="upload-empty"><div className="upload-symbol"><Upload size={28} /></div><h3>Start with your footage</h3><p>Drop a video in. We’ll inspect the frames and prepare your editing workspace.</p><label htmlFor="video-upload" className="button button-primary"><Plus size={16} /> Upload video</label><span className="file-types">MP4 · WEBM · MOV · browser-supported formats</span></div>}
              <input id="video-upload" type="file" accept="video/*" className="hidden-input" onChange={onVideo} />
              {videoUrl && !inspecting && titleVisible && settings.title && <div className="preview-title"><strong>{settings.title}</strong>{settings.subtitle && <span>{settings.subtitle}</span>}</div>}
              {inspecting && <div className="inspect-overlay"><div className="scan-orbit"><span /><span /><span /><Activity size={25} /></div><p className="overline">FRAME ANALYSIS IN PROGRESS</p><h3>Reading your footage<span className="ellipsis">...</span></h3><p>Sampling frames · measuring scene changes · mapping the timeline</p><div className="inspect-progress"><i style={{ width: `${Math.round(inspectProgress * 100)}%` }} /></div><small>{Math.round(inspectProgress * 100)}% COMPLETE</small></div>}
              {!videoUrl && <div className="stage-grid" aria-hidden="true" />}
              {videoUrl && <div className="monitor-corner">REEDITX <span>● REC READY</span></div>}
            </div>
            <div className="monitor-meta"><div className="file-meta"><Film size={14} /><span>{videoFile?.name || "NO MEDIA LOADED"}</span>{videoFile && <small>{niceSize(videoFile.size)}</small>}</div><div className="meta-right"><span>{resolution || "— × —"}</span><strong>{duration ? fmt(duration) : "00:00"}</strong></div></div>
            <div className="monitor-actions"><div className="action-left"><button className="button button-quiet" onClick={() => document.getElementById("video-upload")?.click()}><Upload size={15} /> {videoFile ? "Replace video" : "Choose video"}</button>{videoUrl && <button className="button button-quiet" onClick={togglePlay}>{previewPlaying ? <Pause size={15} /> : <Play size={15} />}{previewPlaying ? "Pause" : "Play preview"}</button>}</div><span className="shortcut-hint">SOURCE <i>→</i> EDIT <i>→</i> EXPORT</span></div>
          </div>

          <div className="panel timeline-panel">
            <div className="panel-head"><div><span className="eyebrow">02 / MULTI-LAYER EDIT</span><h2>Timeline <span className="muted-heading">/ {scenes.length || (duration ? 1 : 0)} blocks</span></h2></div><button className="icon-button" aria-label="Toggle scene markers" onClick={() => setShowScenes(!showScenes)}><Layers3 size={16} /></button></div>
            <div className="timeline-ruler"><span>00:00</span>{Array.from({length:5},(_,i)=><span key={i}>{duration ? fmt(duration*(i+1)/5) : "--:--"}</span>)}</div>
            <div className="timeline-content">
              <div className="track-line"><div className="track-name"><Film size={13} /> VIDEO</div><div className="track-lane video-lane">{videoFile && duration ? (scenes.length ? scenes : [{id:1,start:0,end:duration,duration,label:"SOURCE CLIP"}]).map((scene,index)=><button key={scene.id} className="scene-clip" style={{left:`${scene.start/duration*100}%`,width:`${Math.max(1,(scene.end-scene.start)/duration*100)}%`}} title={`Jump to ${fmt(scene.start)}`} onClick={()=>moveToMarker(scene.start)}><span>{scene.label || `CLIP ${index+1}`}</span><small>{fmt(scene.start)}</small></button>) : <span className="lane-placeholder">Upload footage to build your edit timeline</span>}{showScenes && duration && sceneCuts.map((cut,i)=><button className="cut-marker" style={{left:`${cut/duration*100}%`}} key={cut} title={`Scene change ${fmt(cut)}`} onClick={()=>moveToMarker(cut)} aria-label={`Jump to scene change at ${fmt(cut)}`}><Scissors size={10} /></button>)}</div></div>
              <div className="track-line"><div className="track-name"><AudioLines size={13} /> MUSIC</div><div className={audioFile ? "track-lane music-lane loaded" : "track-lane music-lane"}>{audioFile ? <><div className="wave-bars">{Array.from({length:64},(_,i)=><i key={i} style={{height:`${20+((i*17)%75)}%`}} />)}</div><span className="music-filename"><Music2 size={12} />{audioFile.name}</span></> : <button className="lane-add" onClick={()=>document.getElementById("audio-upload")?.click()}><Plus size={13} /> Add soundtrack</button>}</div></div>
              {settings.title && <div className="track-line"><div className="track-name"><Sparkles size={13} /> TEXT</div><div className="track-lane text-lane"><span>{settings.title}</span><small>{settings.animatedTitles ? "ANIMATED INTRO" : "STATIC TITLE"}</small></div></div>}
            </div>
            <div className="timeline-bottom"><span><i className="legend-dot video-dot" /> Video</span><span><i className="legend-dot audio-dot" /> Soundtrack</span><span><i className="legend-dot marker-dot" /> Detected scene changes {sceneCuts.length ? `(${sceneCuts.length})` : ""}</span><span className="timeline-runtime">{fmt(duration)}</span></div>
          </div>

          {progress.title && <div className="panel export-panel"><div className="panel-head"><div><span className="eyebrow">04 / RENDER STATUS</span><h2>{progress.title}</h2></div><strong className="progress-count">{progress.percent}%</strong></div><div className="export-progress"><i style={{width:`${progress.percent}%`}} /></div><p className="progress-detail">{exporting && <LoaderCircle size={13} className="spin" />}{progress.detail}</p></div>}
        </section>

        <aside className="side-column">
          <div className="panel inspector-panel">
            <div className="panel-head"><div><span className="eyebrow">03 / CREATIVE CONTROLS</span><h2>Remix console</h2></div><SlidersHorizontal size={17} className="head-icon" /></div>
            <div className="inspector-tabs"><button className={activePanel==="look"?"tab active-tab": "tab"} onClick={()=>setActivePanel("look")}><Sparkles size={14} /> Look</button><button className={activePanel==="sound"?"tab active-tab":"tab"} onClick={()=>setActivePanel("sound")}><Music2 size={14}/> Sound</button><button className={activePanel==="text"?"tab active-tab":"tab"} onClick={()=>setActivePanel("text")}><WandSparkles size={14}/> Text</button></div>
            {activePanel==="look" && <div className="inspector-body">
              <div className="control-section"><div className="section-title"><span>Visual treatment</span><span className="section-index">01</span></div><div className="preset-grid">{presetInfo.map(p=><button key={p.id} className={settings.preset===p.id?"preset-card selected":"preset-card"} onClick={()=>patch("preset",p.id)}><span className={`preset-swatch swatch-${p.id}`}><span /></span><strong>{p.label}</strong><small>{p.note}</small>{settings.preset===p.id&&<Check size={13} className="preset-check" />}</button>)}</div></div>
              <div className="control-section"><div className="section-title"><span>Edit rhythm</span><span className="section-index">02</span></div><div className="rhythm-options">{([{id:"steady",label:"Steady",desc:"Natural pace"},{id:"punchy",label:"Punchy",desc:"Quick energy"},{id:"slow",label:"Slow motion",desc:"Half speed"}] as {id:Rhythm;label:string;desc:string}[]).map(r=><button key={r.id} className={settings.rhythm===r.id?"rhythm-option chosen":"rhythm-option"} onClick={()=>patch("rhythm",r.id)}><span>{r.label}</span><small>{r.desc}</small></button>)}</div></div>
              <div className="control-section"><div className="range-label"><label htmlFor="speed">Playback speed</label><strong>{(settings.speed/100).toFixed(2).replace(/0$/,"")}×</strong></div><input id="speed" className="range" type="range" min="25" max="200" step="5" value={settings.speed} onChange={e=>patch("speed",Number(e.target.value))}/><div className="range-ends"><span>0.25×</span><span>2.0×</span></div></div>
              <div className="control-section"><label className="field-label" htmlFor="aspect">Export frame</label><div className="select-wrap"><select id="aspect" value={settings.aspect} onChange={e=>patch("aspect",e.target.value as Aspect)}><option value="original">Original dimensions</option><option value="landscape">Landscape · 16:9</option><option value="portrait">Portrait · 9:16</option><option value="square">Square · 1:1</option></select><ChevronDown size={15}/></div></div>
              <label className="switch-row"><span><b>Quick-cut accents</b><small>Flash accent on detected changes</small></span><input type="checkbox" checked={settings.useQuickCuts} onChange={e=>patch("useQuickCuts",e.target.checked)}/><i /></label>
              <div className="scene-summary"><div className="scene-summary-icon"><Activity size={15}/></div><div><strong>{sceneCuts.length} scene changes detected</strong><small>Frame differences are measured locally, without AI.</small></div></div>
            </div>}
            {activePanel==="sound" && <div className="inspector-body">
              <div className="control-section"><div className="section-title"><span>Your soundtrack</span><span className="section-index">01</span></div><div className="audio-upload-card">{audioFile ? <><div className="audio-file-top"><span className="audio-file-icon"><Music2 size={18}/></span><button className="small-icon" onClick={removeAudio} aria-label="Remove soundtrack"><X size={14}/></button></div><strong className="audio-file-name">{audioFile.name}</strong><small>{niceSize(audioFile.size)} · LOCAL AUDIO</small><audio ref={musicPreviewRef} src={audioUrl} controls /></> : <><div className="audio-file-icon"><Music2 size={19}/></div><strong>Add your own sound</strong><p>Pick a song. It stays on this device and will be mixed on export.</p><label className="button button-primary full-button" htmlFor="audio-upload"><Plus size={15}/> Upload soundtrack</label></>}</div><input id="audio-upload" className="hidden-input" type="file" accept="audio/*" onChange={onAudio}/></div>
              <div className="control-section"><div className="range-label"><label htmlFor="volume">Music volume</label><strong>{settings.volume}%</strong></div><input id="volume" className="range" type="range" min="0" max="100" value={settings.volume} onChange={e=>patch("volume",Number(e.target.value))}/><div className="range-ends"><span>Quiet</span><span>Full</span></div></div>
              <div className="control-section"><div className="range-label"><label htmlFor="sourceVolume">Original audio</label><strong>{settings.sourceVolume}%</strong></div><input id="sourceVolume" className="range" type="range" min="0" max="100" value={settings.sourceVolume} onChange={e=>patch("sourceVolume",Number(e.target.value))}/></div>
              <div className="control-section"><div className="range-label"><label htmlFor="fadeIn">Music fade-in</label><strong>{settings.fadeIn.toFixed(1)} s</strong></div><input id="fadeIn" className="range" type="range" min="0" max="5" step=".5" value={settings.fadeIn} onChange={e=>patch("fadeIn",Number(e.target.value))}/></div>
              <div className="control-section"><div className="range-label"><label htmlFor="fadeOut">Music fade-out</label><strong>{settings.fadeOut.toFixed(1)} s</strong></div><input id="fadeOut" className="range" type="range" min="0" max="8" step=".5" value={settings.fadeOut} onChange={e=>patch("fadeOut",Number(e.target.value))}/></div>
              <p className="hint-box"><ShieldCheck size={14}/> Audio processing happens locally during export. Keep this tab active until the remix finishes.</p>
            </div>}
            {activePanel==="text" && <div className="inspector-body">
              <div className="control-section"><div className="section-title"><span>Animated title card</span><span className="section-index">01</span></div><label className="field-label" htmlFor="title">Main title</label><input id="title" className="text-input" value={settings.title} maxLength={90} placeholder="e.g. THE MOMENT" onChange={e=>patch("title",e.target.value)}/><label className="field-label second-label" htmlFor="subtitle">Sub-title</label><input id="subtitle" className="text-input" value={settings.subtitle} maxLength={120} placeholder="Add a little context…" onChange={e=>patch("subtitle",e.target.value)}/><label className="switch-row switch-text"><span><b>Animated entrance</b><small>Fade + slide into frame</small></span><input type="checkbox" checked={settings.animatedTitles} onChange={e=>patch("animatedTitles",e.target.checked)}/><i /></label><label className="switch-row switch-text"><span><b>Show preview title</b><small>Show text over the monitor</small></span><input type="checkbox" checked={titleVisible} onChange={e=>setTitleVisible(e.target.checked)}/><i /></label></div><div className="title-preview"><span className="eyebrow">TITLE PREVIEW</span><strong>{settings.title || "YOUR TITLE HERE"}</strong><small>{settings.subtitle || "YOUR SUBTITLE HERE"}</small></div><p className="hint-box"><WandSparkles size={14}/> Text is drawn into the exported frames with a timed fade-and-slide animation.</p>
            </div>}
            <div className="panel-bottom"><div className="engine-line"><span className="engine-dot"/><span>REEDITX RULES ENGINE</span><small>NO AI</small></div><div className="api-line"><span>BACKEND</span><b className={serverStatus==="online"?"good":""}>{serverStatus==="online"?"CONNECTED":serverStatus==="checking"?"CHECKING":"LOCAL UI"}</b></div></div>
          </div>

          <div className="panel export-card"><div className="export-card-top"><span className="eyebrow">FINAL OUTPUT</span><span className="export-type">WEBM / 30 FPS</span></div><h3>Bring the cut to life.</h3><p>Render your source, titles, visual treatment and soundtrack into one video. Processing happens locally in real time.</p><button className="button button-primary export-button" onClick={exportRemix} disabled={!videoFile || inspecting || exporting}><span>{exporting?<LoaderCircle size={16} className="spin"/>:<Download size={16}/>}</span>{exporting?"Exporting remix…":"Export remix"}{!exporting&&<span className="export-arrow">↗</span>}</button>{!videoFile&&<small className="export-hint">Upload a video to unlock export.</small>}{videoFile&&inspecting&&<small className="export-hint">Waiting for frame inspection to finish.</small>}{videoFile&&!inspecting&&<small className="export-hint">Keep this tab open while exporting.</small>}<div className="export-note"><ShieldCheck size={13}/> No account. Media stays in browser storage.</div></div>
        </aside>
      </div>
      {notice && <div className="toast" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={()=>setNotice("")}><X size={13}/></button></div>}
      <footer className="page-footer"><span>REEDITX STUDIO <i>·</i> MADE FOR CREATORS</span><span><ShieldCheck size={12}/> YOUR MEDIA STAYS ON THIS DEVICE</span><button onClick={reset}><RefreshCw size={12}/> Clear workspace</button></footer>
    </main>
  );
}
