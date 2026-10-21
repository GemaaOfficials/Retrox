import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const serverEntry = path.join(standalone, "server.js");
const installedNext = path.join(root, "node_modules", "next");
const standaloneNext = path.join(standalone, "node_modules", "next");
const installedSwcHelpers = path.join(root, "node_modules", "@swc", "helpers");
const standaloneSwcHelpers = path.join(standalone, "node_modules", "@swc", "helpers");

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(serverEntry))) {
  throw new Error(`Next.js standalone server was not produced: ${serverEntry}`);
}
if (!(await exists(path.join(installedNext, "package.json")))) {
  throw new Error(`Installed Next.js package is missing: ${installedNext}`);
}

if (!(await exists(path.join(standaloneNext, "package.json")))) {
  await mkdir(path.dirname(standaloneNext), { recursive: true });
  await cp(installedNext, standaloneNext, { recursive: true, force: true });
  console.log("Repaired standalone runtime: copied the Next.js package into .next/standalone/node_modules/next.");
} else {
  console.log("Standalone runtime already contains Next.js; no repair needed.");
}

if (!(await exists(path.join(installedSwcHelpers, "package.json")))) {
  throw new Error(`Installed @swc/helpers package is missing: ${installedSwcHelpers}`);
}
// Standalone tracing can leave a partial helper directory. Overlay the complete
// installed package every time so every runtime helper file is copied.
await mkdir(path.dirname(standaloneSwcHelpers), { recursive: true });
await cp(installedSwcHelpers, standaloneSwcHelpers, { recursive: true, force: true });
console.log("Ensured the complete @swc/helpers package is present in the standalone server bundle.");
