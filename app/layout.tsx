import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "ReEditX — The Remix Studio", description: "A local-first video editing studio. Make music-driven edits, preview them live, and export directly from your browser.", applicationName: "ReEditX", keywords: ["video editor", "remix", "local video editing", "music video"] };
export const viewport: Viewport = { themeColor: "#09090f", width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
