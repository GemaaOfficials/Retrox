"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, CircleHelp, Download, Github, LoaderCircle, MonitorDown, ShieldCheck, Sparkles, X } from "lucide-react";

type InstallerInfo = { available: boolean; version?: string; asset?: { name: string; downloadUrl: string; size: number }; releasesUrl: string; message?: string };
type DownloadState = "idle" | "preparing" | "complete" | "unavailable" | "error";
const releasesUrl = "https://github.com/GemaaOfficials/Retrox/releases";

function bytes(size: number) {
  if (size < 1024 * 1024) return Math.round(size / 1024) + " KB";
  return (size / 1024 / 1024).toFixed(1) + " MB";
}

export default function DownloadHome() {
  const [state, setState] = useState<DownloadState>("idle");
  const [progress, setProgress] = useState(0);
  const [installer, setInstaller] = useState<InstallerInfo | null>(null);
  const [notice, setNotice] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (state !== "preparing") return;
    setProgress(4);
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(92, Math.round(4 + 88 * (1 - Math.exp(-elapsed / 1900)))));
    }, 80);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const beginDownload = async () => {
    if (state === "preparing") return;
    setNotice(""); setInstaller(null); setState("preparing");
    try {
      const response = await fetch("/api/releases/latest", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not check the latest installer release.");
      const data = await response.json() as InstallerInfo;
      setInstaller(data);
      await new Promise(resolve => setTimeout(resolve, 2300));
      if (!data.available || !data.asset?.downloadUrl) {
        setProgress(100); setState("unavailable");
        setNotice(data.message || "The setup package has not been published yet. The installer build workflow is available in GitHub.");
        return;
      }
      const link = document.createElement("a");
      link.href = data.asset.downloadUrl;
      link.download = data.asset.name;
      link.rel = "noopener";
      document.body.appendChild(link); link.click(); link.remove();
      setProgress(100); setState("complete");
      setNotice("Installer download started. Open the downloaded setup file to install ReEditX.");
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 1200));
      setState("error");
      setNotice(error instanceof Error ? error.message : "Installer check failed. Try the GitHub Releases page.");
    }
  };

  const dismiss = () => { setState("idle"); setProgress(0); setNotice(""); };

  return (
    <main className="download-page">
      <header className="download-nav">
        <Link href="/" className="download-brand" aria-label="ReEditX setup home">
          <span className="download-brand-icon"><span>R</span><i /></span>
          <span className="download-brand-words"><strong>ReEdit<span>X</span></strong><small>CREATOR ENGINE</small></span>
        </Link>
        <div className="download-nav-right">
          <span className="system-label"><i /> EDITOR + RENDER SERVER</span>
          <a className="nav-github" href="https://github.com/GemaaOfficials/Retrox" target="_blank" rel="noreferrer"><Github size={15}/> Repository <ArrowUpRight size={13}/></a>
        </div>
      </header>

      <section className="download-hero">
        <div className="red-ribbon-field" aria-hidden="true">
          <svg className="ribbon-svg" viewBox="0 0 900 700" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="redRibbonA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff4b54"/><stop offset=".38" stopColor="#b10d24"/><stop offset=".7" stopColor="#ef2038"/><stop offset="1" stopColor="#630a20"/></linearGradient>
              <linearGradient id="redRibbonB" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff8a87"/><stop offset=".3" stopColor="#fb243e"/><stop offset=".68" stopColor="#8b0821"/><stop offset="1" stopColor="#f02d47"/></linearGradient>
              <linearGradient id="redRibbonC" x1="0" y1="0" x2="0.9" y2="1"><stop offset="0" stopColor="#8c0b21"/><stop offset=".36" stopColor="#ff4154"/><stop offset=".65" stopColor="#c70c2a"/><stop offset="1" stopColor="#570716"/></linearGradient>
              <filter id="ribbonShadow" x="-35%" y="-35%" width="170%" height="170%"><feGaussianBlur stdDeviation="14"/></filter>
            </defs>
            <path className="ribbon-shadow" d="M-180 600 C80 500 190 780 410 520 S660 220 1030 220" fill="none" stroke="#e51435" strokeWidth="88" filter="url(#ribbonShadow)"/>
            <path className="ribbon ribbon-a" d="M-160 610 C70 430 200 730 410 500 S650 170 1030 245" fill="none" stroke="url(#redRibbonA)" strokeWidth="54" strokeLinecap="round"/>
            <path className="ribbon-highlight" d="M-155 590 C70 410 205 710 420 480 S670 155 1030 225" fill="none" stroke="#ff8290" strokeWidth="2" strokeOpacity=".55"/>
            <path className="ribbon ribbon-b" d="M-110 760 C180 520 280 655 475 410 S740 90 980 -60" fill="none" stroke="url(#redRibbonB)" strokeWidth="32" strokeLinecap="round"/>
            <path className="ribbon ribbon-c" d="M160 -90 C80 160 380 130 360 330 S510 485 740 700" fill="none" stroke="url(#redRibbonC)" strokeWidth="45" strokeLinecap="round"/>
            <path className="ribbon-highlight" d="M143 -95 C65 155 359 130 341 330 S494 487 720 700" fill="none" stroke="#ff98a2" strokeWidth="2" strokeOpacity=".44"/>
            <path className="ribbon ribbon-d" d="M620 -40 C405 140 810 180 630 350 S585 555 900 720" fill="none" stroke="url(#redRibbonA)" strokeWidth="26" strokeLinecap="round"/>
            <path className="ribbon ribbon-e" d="M-70 235 C115 70 245 305 402 192 S670 -80 990 80" fill="none" stroke="url(#redRibbonB)" strokeWidth="19" strokeLinecap="round"/>
          </svg>
          <div className="ribbon-grid" />
          <div className="ribbon-grain" />
        </div>

        <div className="download-copy">
          <div className="edition-pill"><span className="edition-dot"/> DESKTOP EDITION <span className="edition-divider"/> WINDOWS 10 / 11</div>
          <h1>Your edits.<br/><em>Unleashed.</em></h1>
          <p className="download-description">Meet ReEditX — a serious remix studio for creators. Drop in your footage, bring a soundtrack, shape every cut, and render locally or connect to a dedicated render server.</p>
          <div className="download-cta-row">
            <button className="download-main-button" onClick={beginDownload} disabled={state==="preparing"}>
              <span className="download-button-icon">{state==="preparing" ? <LoaderCircle size={19} className="ribbon-spin"/> : state==="complete" ? <Check size={20}/> : <ArrowDownToLine size={20}/>}</span>
              <span className="download-button-copy"><strong>{state==="preparing" ? "Preparing ReEditX..." : state==="complete" ? "Download started" : "Download ReEditX"}</strong><small>{installer?.available && installer.asset ? `Windows setup · ${bytes(installer.asset.size)}` : "Windows installer · 64-bit"}</small></span>
              <span className="download-button-arrow">↗</span>
            </button>
            <Link className="open-studio-link" href="/studio">Open web studio <ArrowUpRight size={15}/></Link>
          </div>

          {state!=="idle" && (
            <div className={"download-progress-card " + (state==="error"||state==="unavailable" ? "download-warning" : state==="complete" ? "download-success" : "")} role="status" aria-live="polite">
              <div className="download-progress-top">
                <span>{state==="preparing" ? "PREPARING YOUR INSTALLER" : state==="complete" ? "DOWNLOAD STARTED" : state==="unavailable" ? "INSTALLER NOT PUBLISHED" : "DOWNLOAD CHECK FAILED"}</span>
                <strong>{state==="preparing" ? `${progress}%` : state==="complete" ? "100%" : "—"}</strong>
                <button aria-label="Close download panel" onClick={dismiss}><X size={14}/></button>
              </div>
              <div className="download-progress-track"><i style={{width:`${progress}%`}} className={state==="preparing" ? "progress-glow" : ""}/></div>
              <p>{state==="preparing" ? "Securing the latest build · checking release assets · preparing the download..." : notice}</p>
              {state==="preparing" && <div className="ribbon-loader" aria-hidden="true"><span/><span/><span/><span/><span/><span/><span/></div>}
              {(state==="unavailable"||state==="error") && <a href={releasesUrl} target="_blank" rel="noreferrer">Open GitHub Releases <ArrowUpRight size={13}/></a>}
            </div>
          )}

          <div className="download-facts"><span><ShieldCheck size={14}/> No account required</span><span><MonitorDown size={14}/> Windows desktop setup</span><span><Sparkles size={14}/> Deterministic engine · no AI</span></div>
        </div>

        <div className={"download-visual " + (state==="preparing" ? "visual-downloading" : "")}>
          <div className="device-glow"/>
          <div className="setup-window">
            <div className="setup-window-top"><div className="setup-mini-mark">R<span>X</span></div><div><b>ReEditX<span>.setup</span></b><small>INSTALLATION MANAGER</small></div><div className="window-dots"><i/><i/><i/></div></div>
            <div className="setup-window-body">
              <div className="setup-icon-art"><div className="setup-ribbon setup-ribbon-1"/><div className="setup-ribbon setup-ribbon-2"/><div className="setup-ribbon setup-ribbon-3"/><div className="setup-core">R<span>X</span></div></div>
              <span className="setup-overline">THE CREATOR ENGINE</span>
              <h2>{state==="preparing" ? "Building momentum." : state==="complete" ? "Ready to install." : "Make something epic."}</h2>
              <p>{state==="preparing" ? "Your setup is being prepared." : "Your next edit starts here."}</p>
              <div className="setup-fake-progress"><i style={{width:state==="preparing"?`${progress}%`:state==="complete"?"100%":"7%"}}/></div>
              <div className="setup-window-foot"><span>{state==="preparing" ? "CHECKING BUILD" : state==="complete" ? "DOWNLOAD READY" : "REEDITX STUDIO"}</span><span>{state==="preparing" ? `${progress}%` : "64-BIT"}</span></div>
            </div>
            <div className="setup-footer"><span><span className="setup-status-dot"/> VERIFIED RELEASE ASSETS</span><span>RX / 001</span></div>
          </div>
          <div className="floating-tag tag-top"><span/> FRAME-BY-FRAME</div>
          <div className="floating-tag tag-bottom"><span/> RENDER ENGINE / READY</div>
          <div className="visual-caption"><i/> DESIGNED FOR THE CUT.</div>
        </div>
      </section>

      <section className="feature-strip">
        <div className="feature-intro"><span className="eyebrow">BUILT FOR YOUR WORKFLOW</span><h2>From raw clip<br/>to <em>final cut.</em></h2></div>
        <div className="feature-item"><span className="feature-number">01</span><div className="feature-icon red-icon"><MonitorDown size={19}/></div><h3>Desktop ready</h3><p>A Windows installer pipeline packages the studio into a dedicated desktop shell.</p></div>
        <div className="feature-item"><span className="feature-number">02</span><div className="feature-icon"><Sparkles size={19}/></div><h3>Own your edit</h3><p>Interactive timeline, titles, visual looks, soundtrack mixing and local autosave.</p></div>
        <div className="feature-item"><span className="feature-number">03</span><div className="feature-icon"><ArrowUpRight size={19}/></div><h3>Scale with a server</h3><p>Optional FFmpeg worker API for longer, heavier exports beyond browser recording.</p></div>
      </section>

      <section className="download-bottom">
        <div><span className="eyebrow">THE NEXT FRAME IS YOURS</span><h2>Make it move.</h2><p>The studio stays yours. The render pipeline can grow with you.</p></div>
        <button className="download-bottom-btn" onClick={beginDownload} disabled={state==="preparing"}><Download size={17}/> Get ReEditX Setup <ArrowUpRight size={15}/></button>
      </section>

      <footer className="download-footer"><Link href="/" className="footer-brand">ReEdit<span>X</span><small>.setup</small></Link><span>MEDIA IS YOURS · PROJECTS STAY LOCAL BY DEFAULT</span><div><a href={releasesUrl} target="_blank" rel="noreferrer">Releases</a><a href="https://github.com/GemaaOfficials/Retrox" target="_blank" rel="noreferrer">Source code</a><Link href="/studio">Web studio</Link></div></footer>
    </main>
  );
}
