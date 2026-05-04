/**
 * main.js — Proceso principal de Electron (Node.js)
 *
 * Responsabilidades:
 *   1. Arrancar el servidor Flask (backend.exe) en producción.
 *   2. Crear la ventana principal de la aplicación.
 *   3. Gestionar el envío de correos vía API COM de Outlook (PowerShell).
 *   4. Detener el backend al cerrar la app.
 */

"use strict";

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const os   = require("os");
const fs   = require("fs");
const { spawn } = require("child_process");
const http = require("http");
const https = require("https");

// ─── Estado global ────────────────────────────────────────────────────────────
let mainWindow     = null;
let backendProcess = null;
let backendPort    = null;

// ─── Backend Flask ────────────────────────────────────────────────────────────

function getBackendPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "backend", "backend.exe");
  }
  return null;
}

function pickPort() {
  const env = process.env.SAT_BACKEND_PORT;
  const p = parseInt(env || "", 10);
  return Number.isFinite(p) && p > 0 ? p : 5000;
}

function getDbPath() {
  // Misma lógica que backend/database.py: SAT_DB_PATH → APPDATA → HOME
  const envPath = process.env.SAT_DB_PATH;
  if (envPath) return path.resolve(envPath);

  const appdata = process.env.APPDATA;
  const baseDir = appdata
    ? path.join(appdata, "SAT Llamadas")
    : path.join(os.homedir(), ".sat-llamadas");

  try { fs.mkdirSync(baseDir, { recursive: true }); } catch {}
  return path.join(baseDir, "datos.db");
}

function getBackupDir() {
  const baseDir = path.dirname(getDbPath());
  const backups = path.join(baseDir, "backups");
  try { fs.mkdirSync(backups, { recursive: true }); } catch {}
  return backups;
}

/**
 * POST al API local (mismo patrón que waitForBackend).
 * No usar http.request(urlString): en varias versiones de Node/Electron ignora method u opciones.
 */
function httpPostLocal(fullUrl) {
  let u;
  try {
    u = new URL(fullUrl);
  } catch {
    return Promise.resolve(false);
  }
  const portNum = u.port ? parseInt(u.port, 10) : u.protocol === "https:" ? 443 : 80;
  const lib = u.protocol === "https:" ? https : http;
  const opts = {
    hostname: u.hostname,
    port: portNum,
    path: u.pathname + u.search,
    method: "POST",
    headers: { "Content-Length": "0", Accept: "application/json" },
  };
  return new Promise((resolve) => {
    const req = lib.request(opts, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", (err) => {
      console.warn("[httpPostLocal]", fullUrl, err?.message || err);
      resolve(false);
    });
    req.setTimeout(12000, () => {
      try {
        req.destroy();
      } catch {
        /* ignore */
      }
      resolve(false);
    });
    req.end();
  });
}

/** Pide a Flask volcar WAL → datos.db antes de copiar el archivo (backup en disco desde main). */
async function postAdminCheckpoint() {
  const port = backendPort || pickPort();
  const path = "/api/admin/checkpoint-db";
  if (await httpPostLocal(`http://127.0.0.1:${port}${path}`)) return true;
  return httpPostLocal(`http://localhost:${port}${path}`);
}

async function backupNow({ reason = "startup", keep = 30 } = {}) {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) return null;

  await postAdminCheckpoint();

  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "")
    .replaceAll("-", "")
    .replace(".", "");
  const name = `datos_${stamp}_${reason}.db`;
  const out = path.join(getBackupDir(), name);

  fs.copyFileSync(dbPath, out);

  // Rotación: mantener últimos N
  const files = fs.readdirSync(getBackupDir())
    .filter((f) => f.toLowerCase().endsWith(".db"))
    .map((f) => ({ f, t: fs.statSync(path.join(getBackupDir(), f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  files.slice(keep).forEach(({ f }) => {
    try { fs.unlinkSync(path.join(getBackupDir(), f)); } catch {}
  });

  return out;
}

function startBackend() {
  const backendPath = getBackendPath();
  if (!backendPath) {
    console.log("[Backend] Modo desarrollo — backend gestionado externamente.");
    return;
  }
  backendPort = pickPort();
  console.log("[Backend] Iniciando:", backendPath);
  const env = {
    ...process.env,
    SAT_BACKEND_PORT: String(backendPort),
    SAT_DB_PATH: getDbPath(),
  };
  backendProcess = spawn(backendPath, [], { detached: false, stdio: "ignore", env });
  backendProcess.on("error", (err) => {
    dialog.showErrorBox("Error del servidor", `No se pudo iniciar el servidor interno.\n\n${err.message}`);
  });
  backendProcess.on("exit", (code) => {
    console.log(`[Backend] Finalizado con código: ${code}`);
    backendProcess = null;
  });
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill("SIGTERM");
    backendProcess = null;
  }
}

function getApiBase() {
  const port = backendPort || pickPort();
  return `http://127.0.0.1:${port}/api`;
}

function waitForBackend({ timeoutMs = 12000, intervalMs = 400 } = {}) {
  const start = Date.now();
  const url = `${getApiBase()}/health`;

  return new Promise((resolve, reject) => {
    const tick = () => {
      const elapsed = Date.now() - start;
      if (elapsed > timeoutMs) {
        reject(new Error("Tiempo de espera agotado al iniciar el backend"));
        return;
      }

      http
        .get(url, (res) => {
          res.resume();
          if (res.statusCode === 200) {
            resolve(true);
          } else {
            setTimeout(tick, intervalMs);
          }
        })
        .on("error", () => setTimeout(tick, intervalMs));
    };

    tick();
  });
}

ipcMain.handle("get-config", async () => {
  return { apiBase: getApiBase() };
});

ipcMain.handle("open-data-folder", async () => {
  const folder = path.dirname(getDbPath());
  await shell.openPath(folder);
  return true;
});

ipcMain.handle("export-backup", async () => {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) throw new Error("No existe la base de datos todavía");

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Guardar copia de seguridad",
    defaultPath: path.join(os.homedir(), `SAT_Llamadas_backup_${new Date().toISOString().slice(0, 10)}.db`),
    filters: [{ name: "SQLite DB", extensions: ["db"] }],
  });
  if (canceled || !filePath) return false;

  // WAL → datos.db desde el proceso principal (mismo host/puerto que getConfig); el fetch del renderer suele fallar (null origin / CORS).
  const okCk = await postAdminCheckpoint();
  if (!okCk) {
    throw new Error(
      "No se pudo volcar la base de datos antes de exportar. Compruebe que el servidor Flask " +
        "está en marcha y en el mismo puerto que la app (desarrollo: npm run dev, variable SAT_BACKEND_PORT)."
    );
  }
  fs.copyFileSync(dbPath, filePath);
  return true;
});

ipcMain.handle("restore-backup", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Restaurar copia de seguridad",
    properties: ["openFile"],
    filters: [{ name: "SQLite DB", extensions: ["db"] }],
  });
  if (canceled || !filePaths || !filePaths[0]) return false;

  const src = filePaths[0];
  const dbPath = getDbPath();

  // Backup previo por seguridad (checkpoint para que la copia incluya datos en WAL)
  try {
    await backupNow({ reason: "pre-restore", keep: 60 });
  } catch {}

  // En producción podemos reiniciar el backend para liberar locks.
  if (backendProcess) {
    try { stopBackend(); } catch {}
  }

  // Asegurar carpeta destino
  try { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); } catch {}
  fs.copyFileSync(src, dbPath);
  // Evitar que un -wal/-shm antiguos desvirtúen el archivo recién copiado
  for (const suffix of ["-wal", "-shm"]) {
    try {
      const sidecar = dbPath + suffix;
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    } catch (e) {
      console.warn("[restore-backup] No se pudo borrar sidecar", suffix, e?.message || e);
    }
  }

  // Re-levantar backend si aplica
  if (app.isPackaged) {
    startBackend();
    await waitForBackend().catch(() => {});
  }

  if (mainWindow) {
    mainWindow.webContents.send("db-restored");
  }
  return true;
});

// ─── Envío de correo vía Outlook COM ─────────────────────────────────────────

/**
 * Escapa caracteres especiales HTML para incrustar texto en HTML sin riesgos.
 * @param {string} str
 * @returns {string}
 */
function htmlEsc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Abre Outlook mediante PowerShell y la API COM, pre-rellena los datos de la
 * llamada y deja que Outlook añada automáticamente la firma configurada.
 *
 * Estrategia:
 *   1. Crear un nuevo MailItem con CreateItem(0).
 *   2. Acceder al Inspector para forzar que Outlook cargue la firma en HTMLBody.
 *   3. Anteponer el contenido de la llamada al HTMLBody existente (que ya incluye la firma).
 *   4. Mostrar la ventana de redacción con Display().
 *
 * @param {object} datos
 * @param {string} datos.emailTo   — Destinatario
 * @param {string} datos.asunto    — Asunto del correo
 * @param {string} datos.nombre    — Nombre del llamante
 * @param {string} datos.telefono  — Teléfono del llamante
 * @param {string} datos.notas     — Notas de la llamada
 */
ipcMain.handle("enviar-correo", async (_event, datos) => {
  // Contenido HTML con los datos de la llamada
  const notasHtml = htmlEsc(datos.notas || "").replace(/\n/g, "<br>");
  const tel = String(datos.telefono || "").trim();
  const telBlock = tel
    ? `<p style="font-family:Calibri,sans-serif;font-size:11pt;margin:0 0 6px 0">` +
      `<b>Teléfono:</b> ${htmlEsc(tel)}</p>`
    : "";
  const cuerpoHtml =
    `<p style="font-family:Calibri,sans-serif;font-size:11pt;margin:0 0 6px 0">` +
    `<b>Nombre:</b> ${htmlEsc(datos.nombre)}</p>` +
    telBlock +
    `<p style="font-family:Calibri,sans-serif;font-size:11pt;margin:6px 0 0 0">` +
    `${notasHtml}</p><br>`;

  // Script PowerShell que usa la API COM de Outlook
  // IMPORTANTE: usar comillas normales (no template literal) para evitar
  // que JS interprete los $ y backticks del script de PowerShell
  const psScript = [
    "Set-StrictMode -Version Latest",
    "$ErrorActionPreference = 'Stop'",
    "try {",
    "  $outlook = New-Object -ComObject Outlook.Application",
    "  $mail    = $outlook.CreateItem(0)",
    "  $mail.To      = [System.Environment]::GetEnvironmentVariable('SAT_PARA')",
    "  $mail.Subject = [System.Environment]::GetEnvironmentVariable('SAT_ASUNTO')",
    "  # Forzar que Outlook cargue la firma en HTMLBody",
    "  $null = $mail.GetInspector",
    "  $mail.Display()",
    "  Start-Sleep -Milliseconds 150",
    "  $firma  = $mail.HTMLBody",
    "  $cuerpo = [System.Environment]::GetEnvironmentVariable('SAT_CUERPO')",
    "  $idx = $firma.IndexOf('<body')",
    "  if ($idx -ge 0) {",
    "    $close = $firma.IndexOf('>', $idx)",
    "    $mail.HTMLBody = $firma.Substring(0, $close + 1) + $cuerpo + $firma.Substring($close + 1)",
    "  } else {",
    "    $mail.HTMLBody = $cuerpo + $firma",
    "  }",
    "  # Ya está mostrado; mantener ventana abierta",
    "} catch {",
    "  Write-Error $_.Exception.Message",
    "  exit 1",
    "}",
  ].join("\r\n");

  // Escribir el script en un fichero temporal para evitar problemas de escapado
  const tmpFile = path.join(os.tmpdir(), `sat_mail_${Date.now()}.ps1`);
  // PowerShell en Windows interpreta bien UTF-16 LE si incluye BOM.
  fs.writeFileSync(tmpFile, "\ufeff" + psScript, "utf16le");

  const MAIL_PS_TIMEOUT_MS = 45_000;

  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      SAT_PARA:    datos.emailTo  || "",
      SAT_ASUNTO:  datos.asunto   || "",
      SAT_CUERPO:  cuerpoHtml,
    };

    const ps = spawn("powershell.exe", [
      "-STA",
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", tmpFile,
    ], { env });

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ps.kill(); } catch { /* ignore */ }
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      reject(new Error("Tiempo de espera agotado al abrir Outlook (COM)."));
    }, MAIL_PS_TIMEOUT_MS);

    let stdout = "";
    let stderr = "";
    ps.stdout.on("data", (d) => { stdout += d.toString(); console.log("[PS stdout]", d.toString()); });
    ps.stderr.on("data", (d) => { stderr += d.toString(); console.error("[PS stderr]", d.toString()); });

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    ps.on("close", (code) => {
      console.log(`[PS] Salió con código ${code}. stdout: ${stdout} stderr: ${stderr}`);
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      const errText = (stderr || "").trim();
      finish(() => {
        if (code === 0 && errText === "") resolve(true);
        else reject(new Error((errText || stdout || "").trim() || `PowerShell salió con código ${code}`));
      });
    });

    ps.on("error", (err) => {
      console.error("[PS] Error al lanzar PowerShell:", err);
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      finish(() => { reject(err); });
    });
  });
});

// ─── Ventana principal ────────────────────────────────────────────────────────

function createWindow() {
  const winTitle = `SAT — Registro de Llamadas v${app.getVersion()}`;
  mainWindow = new BrowserWindow({
    width:     1500,
    height:    920,
    minWidth:  1100,
    minHeight: 680,
    title:     winTitle,
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow.setTitle(winTitle);
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

// ─── Ciclo de vida ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  if (app.isPackaged) {
    startBackend();
    try {
      await waitForBackend();
    } catch (err) {
      dialog.showErrorBox(
        "Servidor no disponible",
        `No se pudo iniciar el servidor interno.\n\n${err.message}\n\nLa aplicación se abrirá igualmente, pero puede no cargar datos.`
      );
    }
    // Tras arrancar Flask: checkpoint y copia de arranque coherentes con WAL
    try {
      await backupNow({ reason: "startup", keep: 30 });
    } catch (e) {
      console.warn("[backup] startup:", e?.message || e);
    }
    createWindow();
  } else {
    createWindow();
    try {
      await backupNow({ reason: "startup", keep: 30 });
    } catch (e) {
      console.warn("[backup] startup:", e?.message || e);
    }
  }
});

app.on("before-quit", stopBackend);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
