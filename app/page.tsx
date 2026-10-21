"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Home() {
  useEffect(() => {
    // The installed Android app should launch straight into the editor.
    window.location.replace("/studio");
  }, []);

  return (
    <main style={{
      minHeight: "100svh",
      display: "grid",
      placeItems: "center",
      padding: "24px",
      color: "#f8fafc",
      background: "#09090f",
      fontFamily: "system-ui, sans-serif",
      textAlign: "center",
    }}>
      <section style={{ maxWidth: 480 }}>
        <div style={{ fontSize: 12, letterSpacing: ".24em", color: "#fb7185", fontWeight: 800 }}>
          MADE BY GEMAA
        </div>
        <h1 style={{ fontSize: "clamp(42px, 10vw, 68px)", lineHeight: 1, margin: "18px 0" }}>
          ReEdit<span style={{ color: "#fb405a" }}>X</span>
        </h1>
        <p style={{ color: "#a1a1aa", lineHeight: 1.7, marginBottom: 28 }}>
          Mobile video editing studio. Opening your workspace…
        </p>
        <Link href="/studio" style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 48,
          padding: "0 24px",
          borderRadius: 14,
          background: "#f43f5e",
          color: "#fff",
          fontWeight: 750,
          textDecoration: "none",
        }}>
          Open ReEditX Studio
        </Link>
      </section>
    </main>
  );
}
