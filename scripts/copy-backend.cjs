"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST = path.join(ROOT, "dist-electron", "pack-manifest.json");

function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error("[copy-backend] No existe dist-electron/pack-manifest.json. Ejecuta antes npm run build:electron.");
    process.exit(1);
  }

  const { packagedTo } = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  if (!packagedTo) {
    console.error("[copy-backend] Manifest inválido (falta packagedTo).");
    process.exit(1);
  }

  const backendSrc = path.join(ROOT, "backend", "dist", "backend.exe");
  if (!fs.existsSync(backendSrc)) {
    console.error(`[copy-backend] No existe ${backendSrc}. Ejecuta antes npm run build:backend.`);
    process.exit(1);
  }

  const destDir = path.join(packagedTo, "resources", "backend");
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, "backend.exe");
  fs.copyFileSync(backendSrc, dest);

  console.log(`[copy-backend] OK → ${dest}`);
}

main();
