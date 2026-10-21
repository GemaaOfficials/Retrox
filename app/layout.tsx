import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReEditX — Mobile Video Editor",
  description: "ReEditX is a mobile video remix studio for Android, with local editing and export.",
  applicationName: "ReEditX",
  keywords: ["mobile video editor", "Android video editing", "video remix", "local video editing", "Made by Gemaa"],
};

export const viewport: Viewport = {
  themeColor: "#09090f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
