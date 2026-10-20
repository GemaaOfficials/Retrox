/* eslint @typescript-eslint/no-require-imports: "off" -- Electron main process is a CommonJS entrypoint. */
const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");
const { appUrl } = require("./config.cjs");

let mainWindow = null;
let nextServer = null;
let localOrigin = null;
let quitting = false;

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
    if (nextServer && nextServer.exitCode !== null) {
      throw new Error("The local ReEditX server exited during startup. Check the desktop log.");
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1800) });
      if (response.ok) return;
      lastError = new Error(`Local app returned HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error(`ReEditX could not start in time: ${lastError instanceof Error ? lastError.message : "server timeout"}`);
}

async function startLocalServer() {
  const serverDirectory = path.join(process.resourcesPath, "app-server");
  const serverEntry = path.join(serverDirectory, "server.js");
  const nodeRuntime = path.join(process.resourcesPath, "node.exe");

  if (!fs.existsSync(serverEntry)) {
    throw new Error("The bundled ReEditX app server is missing. Rebuild the installer using the desktop release workflow.");
  }
  if (!fs.existsSync(nodeRuntime)) {
    throw new Error("The bundled Node.js runtime is missing. Rebuild the installer using the desktop release workflow.");
  }

  const port = await pickPort();
  localOrigin = `http://127.0.0.1:${port}`;
  log(`Starting packaged Next.js server at ${localOrigin}`);
  nextServer = spawn(nodeRuntime, [serverEntry], {
    cwd: serverDirectory,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      // Deliberately do not embed or forward any render-server secret to this desktop process.
      REEDITX_DESKTOP: "1",
    },
  });
  nextServer.on("error", error => log(`Server process error: ${error.message}`));
  nextServer.on("exit", (code, signal) => log(`Local server exited: code=${code}; signal=${signal}`));
  await waitForServer(`${localOrigin}/api/health`);
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
    log(`Failed to load ReEditX: ${error.message}`);
    if (!quitting) {
      await dialog.showMessageBox({ type: "error", title: "ReEditX could not open", message: "The ReEditX workspace could not be loaded.", detail: error.message });
      app.quit();
    }
  });
}

async function launch() {
  try {
    if (appUrl && validWebUrl(appUrl)) {
      const origin = new URL(appUrl).origin;
      log(`Opening hosted ReEditX workspace from ${origin}`);
      createWindow(origin);
      return;
    }
    const origin = await startLocalServer();
    createWindow(origin);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(`Startup failure: ${detail}`);
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
    if (BrowserWindow.getAllWindows().length === 0 && (localOrigin || (appUrl && validWebUrl(appUrl)))) {
      createWindow(localOrigin || new URL(appUrl).origin);
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
