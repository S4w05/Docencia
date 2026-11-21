"use strict";

const {contextBridge, ipcRenderer} = require("electron");

contextBridge.exposeInMainWorld("docenciaDesktop", {
  postMessage: request => ipcRenderer.invoke("docencia:request", request),
});
