import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const serverEntry = path.join(standalone, "server.js");
const installedNext = path.join(root, "node_modules", "next");
const standaloneNext = path.join(standalone, "node_modules", "next");
const installedSwcHelpers = path.join(root, "node_modules", "@swc", "helpers");
const standaloneSwcHelpers = path.join(standalone, "node_modules", "@swc", "helpers");
// Next resolves dependencies from its own directory before walking up to the
// standalone root. Keep a complete helper package at both resolution locations.
const standaloneNextSwcHelpers = path.join(standaloneNext, "node_modules", "@swc", "helpers");

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureCompleteSwcHelpers(destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  // Overlay the full npm package on the traced output; tracing can omit esm/.
  await cp(installedSwcHelpers, destination, { recursive: true, force: true });
  const requiredFiles = [
    path.join(destination, "package.json"),
    path.join(destination, "esm", "_interop_require_default.js"),
    path.join(destination, "cjs", "_interop_require_default.cjs"),
  ];
  const missing = [];
  for (const filePath of requiredFiles) {
    if (!(await exists(filePath))) missing.push(filePath);
  }
  if (missing.length) {
    throw new Error(`Incomplete @swc/helpers package at ${destination}; missing: ${missing.join(", ")}`);
  }
}

if (!(await exists(serverEntry))) {
  throw new Error(`Next.js standalone server was not produced: ${serverEntry}`);
}
if (!(await exists(path.join(installedNext, "package.json")))) {
  throw new Error(`Installed Next.js package is missing: ${installedNext}`);
}
if (!(await exists(path.join(installedSwcHelpers, "package.json")))) {
  throw new Error(`Installed @swc/helpers package is missing: ${installedSwcHelpers}`);
}

// Overlay the complete installed Next.js package, not only whatever tracing
// happened to include. This avoids missing internal runtime files in packaged builds.
await mkdir(path.dirname(standaloneNext), { recursive: true });
await cp(installedNext, standaloneNext, { recursive: true, force: true });
console.log("Ensured the complete Next.js package is present in the standalone server bundle.");

await ensureCompleteSwcHelpers(standaloneSwcHelpers);
await ensureCompleteSwcHelpers(standaloneNextSwcHelpers);

console.log("Verified complete @swc/helpers CJS and ESM files at both runtime resolution locations.");
