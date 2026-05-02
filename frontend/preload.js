/**
 * preload.js — Puente seguro entre el proceso principal (Node.js) y el renderer (HTML/JS).
 *
 * Expone únicamente las funciones necesarias al renderer mediante contextBridge,
 * sin dar acceso directo a Node.js ni a los módulos de Electron.
 */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * Devuelve configuración del proceso principal (p.ej. apiBase).
   * @returns {Promise<{ apiBase: string }>}
   */
  getConfig: () => ipcRenderer.invoke("get-config"),

  /** Abre la carpeta donde se guarda la base de datos y backups */
  openDataFolder: () => ipcRenderer.invoke("open-data-folder"),

  /** Exporta (copia) la base de datos a una ruta elegida por el usuario */
  exportBackup: () => ipcRenderer.invoke("export-backup"),

  /** Restaura una base de datos desde un .db elegido por el usuario */
  restoreBackup: () => ipcRenderer.invoke("restore-backup"),

  /** Se dispara cuando se restaura la BD (para recargar la UI) */
  onDbRestored: (cb) => ipcRenderer.on("db-restored", () => cb()),

  /**
   * Abre Outlook con los datos de la llamada pre-rellenados y la firma del usuario.
   * @param {{ emailTo, asunto, nombre, telefono, notas }} datos
   * @returns {Promise<boolean>}
   */
  enviarCorreo: (datos) => ipcRenderer.invoke("enviar-correo", datos),
});
