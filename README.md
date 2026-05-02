# 📞 SAT Call Logger - Registro de Llamadas

Aplicación de escritorio moderna para registrar y gestionar llamadas entrantes al servicio SAT (Servicio de Atención Técnica).

## 🎯 Características

- ✅ Crear registros de llamadas con información detallada
- ✅ Editar registros existentes
- ✅ Eliminar registros
- ✅ Listar todas las llamadas con búsqueda y filtrado
- ✅ Interfaz limpia y moderna
- ✅ Base de datos local (SQLite)
- ✅ Multiplataforma (Windows, Mac, Linux)

## 💻 Tecnología

- **Frontend**: Electron + HTML/CSS/JavaScript
- **Backend**: Python + Flask
- **Base de Datos**: SQLite
- **API**: REST API

## 📋 Requisitos Previos

- **Node.js** (v14 o superior): [Descargar](https://nodejs.org/)
- **Python** (v3.8 o superior): [Descargar](https://www.python.org/)
- **npm** (viene con Node.js)

## 🚀 Instalación

### 1. Clonar o descargar el proyecto
```bash
cd App\ Llamadas
```

### 2. Instalar dependencias de Node.js
```bash
npm install
```

### 3. Instalar dependencias de Python
```bash
cd backend
pip install -r requirements.txt
cd ..
```

## ▶️ Ejecución

### Opción 1: Ejecutar Backend y Frontend por separado (Recomendado para desarrollo)

**Terminal 1 - Backend:**
```bash
cd backend
python app.py
```

Verás algo como:
```
 * Running on http://127.0.0.1:5000
```

**Terminal 2 - Frontend:**
```bash
npm start
```

Se abrirá la aplicación Electron automáticamente.

### Opción 2: Ejecutar ambos simultáneamente
```bash
npm run dev
```

El backend de desarrollo usa el puerto **5001** (`SAT_BACKEND_PORT`), para no chocar con instancias antiguas en **5000** (por ejemplo `backend.exe` de la app empaquetada).

### Liberar puertos 5000 y 5001 antes de arrancar (Windows)

Si quieres cerrar procesos que sigan escuchando en **5000** u **5001** (Python o `backend.exe` viejos) y luego abrir el entorno de desarrollo:

```powershell
npm run dev:clean
```

Equivale a ejecutar `scripts/free-port-dev.ps1` y después `npm run dev`. Para solo **ver** qué PIDs usarían esos puertos, sin matarlos:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/free-port-dev.ps1 -WhatIf
```

### Tests del API (pytest)

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest
```

Incluye comprobaciones mínimas: crear llamada **sin teléfono**, estados **válidos** e **inválidos**, y nombre obligatorio.

## 📊 Uso

1. **Nueva Llamada**: Haz clic en el botón "+ Nueva Llamada"
2. **Llenar Datos**: Completa los campos del formulario:
   - Fecha y Hora
   - Número de Teléfono
   - Nombre del Llamante
   - Duración (en minutos)
   - Motivo
   - Notas adicionales
3. **Guardar**: Haz clic en "Guardar"
4. **Editar**: Haz clic en "Editar" en cualquier fila de la tabla
5. **Eliminar**: Haz clic en "Eliminar" (con confirmación)

## 📁 Estructura del Proyecto

```
App Llamadas/
├── backend/
│   ├── app.py              # Servidor Flask
│   ├── models.py           # Modelo de datos
│   ├── database.py         # Configuración de BD
│   ├── requirements.txt    # Dependencias Python
│   ├── requirements-dev.txt # pytest (desarrollo)
│   └── tests/              # Tests API (pytest)
├── frontend/
│   ├── main.js             # Proceso Electron
│   ├── preload.js          # Seguridad Electron
│   ├── index.html          # Interfaz
│   ├── app.js              # Lógica del frontend
│   └── styles.css          # Estilos
├── package.json            # Configuración Node.js
└── README.md               # Este archivo
```

## 🗄️ Base de Datos

Los datos se guardan automáticamente en un archivo `datos.db` en la raíz del proyecto. Este es un archivo SQLite que puedes abrir con herramientas como:

- [DB Browser for SQLite](https://sqlitebrowser.org/)
- [DBeaver](https://dbeaver.io/)

## 🐛 Solución de Problemas

### "No se puede conectar con el servidor"
- Verifica que el backend esté corriendo en Terminal 1
- Asegúrate que el puerto 5000 no esté en uso
- Intenta: `lsof -i :5000` (Mac/Linux) o `netstat -ano | findstr :5000` (Windows)

### "Error al instalar dependencias de Python"
- Verifica que tienes Python 3.8 o superior instalado
- Intenta crear un entorno virtual:
  ```bash
  cd backend
  python -m venv venv
  source venv/bin/activate  # En Windows: venv\Scripts\activate
  pip install -r requirements.txt
  ```

### "No se abre la aplicación Electron"
- Verifica que Node.js y npm estén instalados correctamente
- Intenta limpiar y reinstalar:
  ```bash
  rm -rf node_modules
  npm install
  npm start
  ```

## 📝 Notas de Desarrollo

- El frontend hace peticiones HTTP al backend en `http://localhost:5000`
- La BD se crea automáticamente en la primera ejecución
- Los datos se almacenan localmente, sin conexión a internet
- Cada registro tiene timestamp automático de creación

## 📄 Licencia

MIT License - Siéntete libre de usar, modificar y distribuir esta aplicación.

## 💡 Próximas Mejoras

- [ ] Búsqueda y filtrado avanzado
- [ ] Reportes y exportación a Excel
- [ ] Gráficas de estadísticas
- [ ] Sincronización en la nube
- [ ] Autenticación de usuarios

---

¿Preguntas o sugerencias? Crea un issue en el repositorio.
