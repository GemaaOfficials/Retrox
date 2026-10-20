import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
export const metadata: Metadata = { title: "ReEditX.setup — Desktop Creator Engine", description: "Download ReEditX.setup, a creator-focused video remix studio with local editing and optional server rendering.", applicationName: "ReEditX", keywords: ["video editor", "remix", "local video editing", "music video"] };
export const viewport: Viewport = { themeColor: "#09090f", width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
