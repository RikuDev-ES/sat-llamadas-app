"use strict";

const fs = require("fs");
const path = require("path");
const { packager } = require("@electron/packager");

const ROOT = path.resolve(__dirname, "..");
const APP_NAME = "SAT Llamadas";
const DEFAULT_OUT = path.join(ROOT, "dist-electron");
const TARGET_DIR = path.join(DEFAULT_OUT, `${APP_NAME}-win32-x64`);
const MANIFEST = path.join(DEFAULT_OUT, "pack-manifest.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function rmWithRetries(p, { retries = 8, delayMs = 250 } = {}) {
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    try {
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return null;
    } catch (e) {
      lastErr = e;
      await sleep(delayMs);
    }
  }
  return lastErr;
}

async function main() {
  // Intentar limpiar salida previa (en Windows a veces queda bloqueada)
  if (fs.existsSync(TARGET_DIR)) {
    const err = await rmWithRetries(TARGET_DIR);
    if (err) {
      console.warn(
        "[pack] No se pudo borrar la carpeta previa (probable bloqueo). Se empaquetará en una carpeta alternativa.\n" +
          `Detalle: ${err.message || err}`
      );
    }
  }

  let outDir = DEFAULT_OUT;
  if (fs.existsSync(TARGET_DIR)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").slice(0, 15);
    outDir = path.join(ROOT, `dist-electron-${stamp}`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const appPaths = await packager({
    dir: ROOT,
    name: APP_NAME,
    platform: "win32",
    arch: "x64",
    out: outDir,
    overwrite: true,
    ignore: [
      /^\/backend\/build(\/|$)/,
      /^\/backend\/__pycache__(\/|$)/,
      /^\/dist-electron(\/|$)/,
      /^\/dist-electron-[^/]+(\/|$)/,
      /^\/build\.bat$/i,
      /^\/README\.md$/i,
      // No empaquetar ZIPs de releases (si no, cada versión incluye la anterior y el .zip crece enormemente)
      /^\/SAT-Llamadas-win32-x64\.zip$/i,
      /^\/SAT-Llamadas-win32-x64-v.*\.zip$/i,
    ],
  });

  const packagedTo = Array.isArray(appPaths) && appPaths[0] ? appPaths[0] : path.join(outDir, `${APP_NAME}-win32-x64`);

  fs.writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        packagedTo,
        outDir,
        appName: APP_NAME,
        createdAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`[pack] OK → ${packagedTo}`);
}

main().catch((e) => {
  console.error("[pack] ERROR:", e);
  process.exit(1);
});
