/* eslint @typescript-eslint/no-require-imports: "off" -- Electron main process is a CommonJS entrypoint. */
const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");

let mainWindow = null;
let nextServer = null;
let localOrigin = null;
let quitting = false;
let serverSpawnError = null;
const serverOutputTail = [];

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function logFile() {
  return path.join(app.getPath("userData"), "reeditx-desktop.log");
}

function log(message) {
  try { fs.appendFileSync(logFile(), `[${new Date().toISOString()}] ${message}\n`); } catch {}
}

function logServerLine(streamName, line) {
  const safeLine = line.length > 2500 ? `${line.slice(0, 2500)}… [truncated]` : line;
  const entry = `[server ${streamName}] ${safeLine}`;
  serverOutputTail.push(entry);
  if (serverOutputTail.length > 60) serverOutputTail.shift();
  log(entry);
}

function captureServerOutput(stream, streamName) {
  if (!stream) return;
  stream.setEncoding("utf8");
  let pending = "";
  stream.on("data", chunk => {
    const parts = (pending + chunk).split(/\r?\n/);
    pending = parts.pop() || "";
    for (const line of parts) {
      if (line.trim()) logServerLine(streamName, line);
    }
  });
  stream.on("end", () => {
    if (pending.trim()) logServerLine(streamName, pending);
  });
}

function recentServerOutput() {
  if (serverOutputTail.length === 0) return "";
  return `\n\nRecent local server output:\n${serverOutputTail.slice(-12).join("\n")}`;
}

function availablePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function pickPort() {
  for (let port = 3471; port <= 3499; port += 1) {
    try { return await availablePort(port); } catch {}
  }
  throw new Error("No available local ReEditX port was found.");
}

async function waitForServer(url) {
  let lastError = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (serverSpawnError) {
      throw new Error(`Windows could not launch Electron's embedded Node.js runtime: ${serverSpawnError.message}${recentServerOutput()}`);
    }
    if (nextServer && (nextServer.exitCode !== null || nextServer.signalCode !== null)) {
      throw new Error(
        `The local ReEditX server exited during startup (exit code: ${nextServer.exitCode ?? "none"}; signal: ${nextServer.signalCode ?? "none"}).${recentServerOutput()}`,
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1800) });
      if (response.ok) return;
      lastError = new Error(`Local app returned HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error(`ReEditX could not start in time: ${lastError instanceof Error ? lastError.message : "server timeout"}${recentServerOutput()}`);
}

async function startLocalServer() {
  const serverDirectory = path.join(process.resourcesPath, "app-server");
  const serverEntry = path.join(serverDirectory, "server.js");
  const buildIdFile = path.join(serverDirectory, ".next", "BUILD_ID");
  const appRuntime = process.execPath;

  serverSpawnError = null;
  serverOutputTail.length = 0;

  const missingFiles = [
    [appRuntime, "Electron application runtime"],
    [serverEntry, "bundled Next.js server"],
    [buildIdFile, "Next.js production build metadata"],
  ].filter(([filePath]) => !fs.existsSync(filePath));

  if (missingFiles.length > 0) {
    const missing = missingFiles.map(([filePath, label]) => `${label}: ${filePath}`).join("\n");
    throw new Error(`The installed ReEditX package is incomplete. Missing required files:\n${missing}\nRe-download the installer and install it again.`);
  }

  const port = await pickPort();
  localOrigin = `http://127.0.0.1:${port}`;
  log(`Starting packaged Next.js server at ${localOrigin}`);
  log(`Electron embedded Node.js runtime: ${appRuntime}`);
  log(`Bundled server entry: ${serverEntry}`);

  // Keep machine-specific Node settings from breaking the bundled production server.
  const serverEnv = { ...process.env };
  for (const name of ["NODE_OPTIONS", "NODE_PATH"]) delete serverEnv[name];
  Object.assign(serverEnv, {
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    // Deliberately do not embed or forward any render-server secret to this desktop process.
    ELECTRON_RUN_AS_NODE: "1",
    REEDITX_DESKTOP: "1",
  });

  nextServer = spawn(appRuntime, [serverEntry], {
    cwd: serverDirectory,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: serverEnv,
  });
  captureServerOutput(nextServer.stdout, "stdout");
  captureServerOutput(nextServer.stderr, "stderr");
  nextServer.on("error", error => {
    serverSpawnError = error;
    log(`Server process error: ${error.stack || error.message}`);
  });
  nextServer.on("exit", (code, signal) => {
    log(`Local server exited: code=${code}; signal=${signal || "none"}${recentServerOutput()}`);
  });

  await waitForServer(`${localOrigin}/api/health`);
  log("Local ReEditX server passed the health check.");
  return localOrigin;
}

function validWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch { return false; }
}

function setupWindowGuards(window, allowedOrigin) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (validWebUrl(url) && !url.startsWith(allowedOrigin)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).origin === allowedOrigin) return;
    } catch {}
    event.preventDefault();
    if (validWebUrl(url)) void shell.openExternal(url);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    log(`Renderer stopped: ${JSON.stringify(details)}`);
  });
}

function createWindow(origin) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 950,
    minWidth: 960,
    minHeight: 660,
    backgroundColor: "#09090f",
    title: "ReEditX Studio",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  setupWindowGuards(mainWindow, origin);
  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadURL(new URL("/studio", origin).toString()).catch(async error => {
    log(`Failed to load ReEditX: ${error.stack || error.message}`);
    if (!quitting) {
      await dialog.showMessageBox({ type: "error", title: "ReEditX could not open", message: "The ReEditX workspace could not be loaded.", detail: error.message });
      app.quit();
    }
  });
}

async function launch() {
  try {
    const origin = await startLocalServer();
    createWindow(origin);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(`Startup failure: ${error instanceof Error ? error.stack || error.message : detail}`);
    await dialog.showMessageBox({
      type: "error",
      title: "ReEditX could not start",
      message: "The ReEditX editing engine did not start correctly.",
      detail: `${detail}\n\nLog file: ${logFile()}`,
      buttons: ["Close"],
    });
    app.quit();
  }
}

if (gotLock) {
  app.whenReady().then(launch);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && localOrigin) {
      createWindow(localOrigin);
    }
  });
  app.on("before-quit", () => {
    quitting = true;
    if (nextServer && !nextServer.killed) nextServer.kill();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
