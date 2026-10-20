import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const token = "reeditx-smoke-test-token";
const server = net.createServer();
const port = await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const assigned = server.address().port;
    server.close(error => error ? reject(error) : resolve(assigned));
  });
});
const child = spawn(process.execPath, [path.join(here, "index.mjs")], {
  cwd: here,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    RENDER_API_TOKEN: token,
    REEDITX_JOB_DIR: path.join(here, ".smoke-test-jobs"),
    MAX_CONCURRENT_RENDERS: "1",
  },
});
let logs = "";
child.stdout.on("data", chunk => { logs += chunk.toString(); });
child.stderr.on("data", chunk => { logs += chunk.toString(); });
const origin = `http://127.0.0.1:${port}`;
async function waitForHealth() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Worker exited before health check.\n${logs}`);
    try {
      const response = await fetch(origin + "/health", { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Worker health check timed out.\n${logs}`);
}
try {
  const health = await waitForHealth();
  assert.equal(health.name, "ReEditX Render Worker");
  assert.equal(health.status, "ok");
  assert.equal(health.maxConcurrent, 1);

  const denied = await fetch(origin + "/api/jobs/00000000-0000-4000-8000-000000000000");
  assert.equal(denied.status, 401, "job status must require the render token");

  const form = new FormData();
  form.set("settings", JSON.stringify({ speed: 1, volume: 70, preset: "cinema" }));
  const invalid = await fetch(origin + "/api/render", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(invalid.status, 400, "render endpoint must reject requests without a video");
  const invalidBody = await invalid.json();
  assert.equal(invalidBody.code, "VIDEO_REQUIRED");

  console.log("ReEditX render worker smoke test passed: health, auth guard, request validation.");
} finally {
  child.kill("SIGTERM");
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  await import("node:fs/promises").then(fs => fs.rm(path.join(here, ".smoke-test-jobs"), { recursive: true, force: true })).catch(() => {});
}
