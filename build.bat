@echo off
:: ============================================================
:: build.bat — Script de construcción de la app SAT Llamadas
::
:: Pasos:
::   1. Compila el backend Flask con PyInstaller → backend.exe
::   2. Instala dependencias Node si hace falta
::   3. Empaqueta la app Electron con electron-packager
::   4. Copia backend.exe al directorio de recursos
::
:: Requisitos previos:
::   · Python 3.12 instalado en la ruta indicada abajo
::   · Node.js + npm instalados y en el PATH
:: ============================================================

setlocal enabledelayedexpansion
title Build SAT Llamadas

:: Python 3.12 — PyInstaller no soporta Python 3.14+
set PYTHON="C:\Users\RIKUDEV\AppData\Local\Programs\Python\Python312\python.exe"

echo.
echo ============================================================
echo  SAT Registro de Llamadas - Generando paquete .exe
echo ============================================================
echo.

:: ── Paso 1: Compilar backend con PyInstaller ──────────────────
echo [1/4] Compilando backend Flask con PyInstaller...
echo.

cd backend

%PYTHON% -m pip install -r requirements.txt --quiet
if !errorlevel! neq 0 (
    echo ERROR: No se pudieron instalar las dependencias del backend.
    pause & exit /b 1
)

%PYTHON% -m PyInstaller --onefile --name backend --distpath dist --noconfirm app.py
if !errorlevel! neq 0 (
    echo ERROR: PyInstaller fallo. Revisa los logs de arriba.
    pause & exit /b 1
)

cd ..
echo.
echo [OK] Backend compilado: backend\dist\backend.exe
echo.

:: ── Paso 2: Instalar dependencias Node ───────────────────────
echo [2/4] Instalando dependencias Node.js...
echo.

npm install --quiet
if !errorlevel! neq 0 (
    echo ERROR: npm install fallo.
    pause & exit /b 1
)

echo [OK] Dependencias Node instaladas.
echo.

:: ── Paso 3: Empaquetar con electron-packager ─────────────────
echo [3/4] Empaquetando aplicacion Electron...
echo.

npm run build:electron
if !errorlevel! neq 0 (
    echo ERROR: electron-packager fallo.
    pause & exit /b 1
)

echo.
echo [OK] App Electron empaquetada.
echo.

:: ── Paso 4: Copiar backend.exe al paquete ────────────────────
echo [4/4] Copiando backend al paquete...
echo.

npm run build:copy-backend
if !errorlevel! neq 0 (
    echo ERROR: No se pudo copiar el backend.
    pause & exit /b 1
)

echo.
echo ============================================================
echo  Build completado con exito!
echo  App lista en: dist-electron\SAT Llamadas-win32-x64\
echo  Ejecutar con: "SAT Llamadas.exe"
echo ============================================================
echo.
pause
