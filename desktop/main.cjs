"use strict";

const {app, BrowserWindow, dialog, ipcMain, shell} = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {RegisterStore, writeAtomic} = require("./store.cjs");

app.setName("Docencia");
const smoke = process.argv.includes("--verificar-docencia");
if (smoke) app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "docencia-smoke-")));
const acquired = app.requestSingleInstanceLock();
const index = path.join(__dirname, "..", "src", "index.html");
const indexURL = pathToFileURL(index).href;
const xlsx = [{name: "Libros de Excel", extensions: ["xlsx"]}];
const limit = 35 * 1024 * 1024;
let window, store;

function workbookBytes(request) {
  if (typeof request.bytes !== "string" || typeof request.name !== "string" ||
      !/\.xlsx$/i.test(request.name) || !request.name.trim()) throw Error("Archivo de Excel inválido.");
  const bytes = Buffer.from(request.bytes, "base64");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw Error("Archivo de Excel inválido.");
  return [path.basename(request.name), bytes];
}

ipcMain.handle("docencia:request", async (event, request) => {
  if (!window || event.sender !== window.webContents || event.senderFrame?.url !== indexURL ||
      event.senderFrame !== window.webContents.mainFrame || !request || typeof request !== "object") {
    throw Error("Petición inválida.");
  }
  const {action, key} = request;
  switch (action) {
  case "catalog": return store.catalog();
  case "load": return store.load(key);
  case "restore": return store.restore(key);
  case "save":
    if (typeof request.draft !== "string") throw Error("Borrador inválido.");
    return store.save(key, request.draft);
  case "remember": {
    const [name, bytes] = workbookBytes(request);
    if (bytes.length > limit) throw Error("Selecciona un Excel de hasta 35 MB.");
    return store.remember(key, name, bytes);
  }
  case "archive": case "unarchive": return store.archive(key, action === "archive");
  case "newAcademicTerm": return store.startSemester();
  case "openAcademicTerm": return store.openSemester(key);
  case "revealFolder": {
    if (!store.catalog().available) throw Error("La carpeta de datos no está disponible.");
    const error = await shell.openPath(store.folder);
    if (error) throw Error(error);
    return true;
  }
  case "chooseFolder": {
    const result = await dialog.showOpenDialog(window, {title: "Elegir carpeta de datos",
      properties: ["openDirectory", "createDirectory"]});
    return result.canceled ? null : store.relocate(result.filePaths[0]);
  }
  case "choose": {
    const result = await dialog.showOpenDialog(window, {title: "Importar lista de Excel", filters: xlsx, properties: ["openFile"]});
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if (fs.statSync(file).size > limit) throw Error("Selecciona un Excel de hasta 35 MB.");
    return {name: path.basename(file), bytes: fs.readFileSync(file).toString("base64")};
  }
  case "export": {
    const [name, bytes] = workbookBytes(request);
    const result = await dialog.showSaveDialog(window, {title: "Guardar Excel", defaultPath: name, filters: xlsx});
    if (result.canceled) return false;
    writeAtomic(result.filePath, bytes);
    return true;
  }
  case "confirm": {
    if (typeof request.message !== "string") throw Error("Petición inválida.");
    const result = await dialog.showMessageBox(window, {type: "question", message: request.message,
      buttons: ["Continuar", "Cancelar"], defaultId: 1, cancelId: 1, noLink: true});
    return result.response === 0;
  }
  default: throw Error("Operación no admitida.");
  }
});

if (!acquired) app.quit();
else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(async () => {
    store = new RegisterStore(app.getPath("userData"));
    window = new BrowserWindow({title: "Docencia", width: 1110, height: 790, minWidth: 700, minHeight: 470,
      icon: path.join(__dirname, "..", "src", "Docencia.png"), show: !smoke,
      webPreferences: {preload: path.join(__dirname, "preload.cjs"), sandbox: true,
        nodeIntegration: false, contextIsolation: true, webSecurity: true}});
    window.webContents.setWindowOpenHandler(() => ({action: "deny"}));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    await window.loadFile(index);
    if (smoke) {
      const passed = await window.webContents.executeJavaScript(`
        (async () => {
          const catalog = await send("catalog");
          return catalog.available && typeof openBook === "function" &&
            typeof subjectSummary === "function" && typeof Uint8Array.fromBase64 === "function";
        })()
      `);
      app.exit(passed ? 0 : 1);
    }
  }).catch(error => {
    if (!smoke) dialog.showErrorBox("Docencia", error.message);
    console.error(error);
    app.exit(1);
  });
}
app.on("window-all-closed", () => app.quit());
