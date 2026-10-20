const { app, BrowserWindow, shell, dialog } = require("electron");

const configuredServer = process.env.REEDITX_SERVER_URL || "https://reeditx.up.railway.app";
const serverUrl = new URL(configuredServer);
if (serverUrl.protocol !== "https:" && serverUrl.hostname !== "localhost" && serverUrl.hostname !== "127.0.0.1") {
  throw new Error("ReEditX requires HTTPS for its remote studio server.");
}

let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    title: "ReEditX Studio",
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#09090f",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === "https:" || target.protocol === "mailto:") shell.openExternal(target.href);
    } catch {}
    return { action: "deny" };
  });

  mainWindow.loadURL(new URL("/studio", serverUrl).href).catch(async () => {
    await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "ReEditX server unavailable",
      message: "ReEditX can't connect to its editing server right now.",
      detail: "Check your internet connection and try again. Your installer is okay; the render server may be deploying or temporarily offline.",
      buttons: ["Retry", "Close"],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0 && mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(new URL("/studio", serverUrl).href);
      else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    });
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}
app.whenReady().then(() => {
  app.setAppUserModelId("com.gemaa.reeditx");
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
