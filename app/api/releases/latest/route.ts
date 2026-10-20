import { NextResponse } from "next/server";

export const revalidate = 60;

type GithubAsset = { name: string; browser_download_url: string; size: number };
type GithubRelease = { tag_name: string; html_url: string; assets: GithubAsset[]; draft: boolean; prerelease: boolean };

export async function GET() {
  const releasesUrl = "https://github.com/GemaaOfficials/Retrox/releases";
  try {
    const response = await fetch("https://api.github.com/repos/GemaaOfficials/Retrox/releases/latest", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "ReEditX-Setup-Portal" },
      next: { revalidate: 60 },
    });
    if (!response.ok) {
      return NextResponse.json({ available: false, releasesUrl, message: "The installer has not been published yet. The Windows build workflow is ready in GitHub Actions." }, { headers: { "Cache-Control": "no-store" } });
    }
    const release = await response.json() as GithubRelease;
    const asset = release.assets?.find(item => /^ReEditX-Setup(?:-[\w.-]+)?\.exe$/i.test(item.name) || /^ReEditX-Setup.*\.exe$/i.test(item.name));
    if (!asset || release.draft || release.prerelease) {
      return NextResponse.json({ available: false, version: release.tag_name, releasesUrl, message: "The latest release does not contain a published Windows setup installer yet. Check the Releases page for the first stable build." }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ available: true, version: release.tag_name, asset: { name: asset.name, downloadUrl: asset.browser_download_url, size: asset.size }, releasesUrl: release.html_url }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ available: false, releasesUrl, message: "Could not reach GitHub right now. You can still check the Releases page directly." }, { headers: { "Cache-Control": "no-store" } });
  }
}
