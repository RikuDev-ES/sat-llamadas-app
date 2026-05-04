/**
 * app.js — Lógica del renderer de Electron (interfaz de usuario)
 *
 * Módulos funcionales:
 *   · Carga y caché de llamadas desde la API REST
 *   · Filtrado en tiempo real y ordenación por columnas
 *   · Paginación dinámica adaptada al tamaño de la ventana
 *   · Panel lateral para crear / editar / duplicar llamadas
 *   · Diálogos personalizados (evita el bug de foco de confirm() en Electron)
 *   · Exportación a CSV con BOM UTF-8
 *   · Envío de correo vía protocolo mailto: (Outlook)
 *   · Modo oscuro / claro con persistencia en localStorage
 *   · Validación de número de teléfono en tiempo real
 *   · Atajos: Ctrl/Cmd+N nueva llamada, Esc cierra panel/diálogos, / y Ctrl/Cmd+F foco en búsqueda
 *   · Filtros compactos (estado + fecha + rango opcional), indicador Sin tel. en tabla
 */

"use strict";

// ─── Constantes ───────────────────────────────────────────────────────────────

/** URL base de la API Flask */
let API_URL = "http://localhost:5000/api";

/**
 * Altura en píxeles de cada fila de la tabla.
 * Debe coincidir con el CSS: height: 42px + 1px de borde inferior.
 */
const FILA_ALTURA = 43;

// ─── Referencias DOM ──────────────────────────────────────────────────────────

const panel               = document.getElementById("panel");
const formLlamada         = document.getElementById("formLlamada");
const btnNuevaLlamada     = document.getElementById("btnNuevaLlamada");
const closePanel          = document.getElementById("closePanel");
const cancelBtn           = document.getElementById("cancelBtn");
const llamadasBody        = document.getElementById("llamadasBody");
const panelOverlay        = document.querySelector(".panel-overlay");
const dialogConfirm       = document.getElementById("dialogConfirm");
const dialogCancelar      = document.getElementById("dialogCancelar");
const dialogEliminar      = document.getElementById("dialogEliminar");
const dialogRestore       = document.getElementById("dialogRestore");
const dialogRestoreCancelar  = document.getElementById("dialogRestoreCancelar");
const dialogRestoreConfirmar = document.getElementById("dialogRestoreConfirmar");
const dialogEmail         = document.getElementById("dialogEmail");
const btnConfigEmail      = document.getElementById("btnConfigEmail");
const dialogEmailCancelar = document.getElementById("dialogEmailCancelar");
const dialogEmailGuardar  = document.getElementById("dialogEmailGuardar");
const inputEmailDefault   = document.getElementById("inputEmailDefault");
const inputFirmaEmail     = document.getElementById("inputFirmaEmail");
const btnModoOscuro       = document.getElementById("btnModoOscuro");
const btnDatos            = document.getElementById("btnDatos");
const btnBackup           = document.getElementById("btnBackup");
const btnRestore          = document.getElementById("btnRestore");
const btnExportarCSV      = document.getElementById("btnExportarCSV");
const busquedaInput       = document.getElementById("busqueda");
const btnAhora            = document.getElementById("btnAhora");
const paginacionDiv       = document.getElementById("paginacion");
const chkSinTelefono      = document.getElementById("sin_telefono");
const grupoTelefono       = document.getElementById("grupoTelefono");
const filtroEstadoChips   = document.getElementById("filtroEstadoChips");
const filtroFechaChips    = document.getElementById("filtroFechaChips");
const filtroRangoPersonalizado = document.getElementById("filtroRangoPersonalizado");
const filtroFechaDesde    = document.getElementById("filtroFechaDesde");
const filtroFechaHasta    = document.getElementById("filtroFechaHasta");

// ─── Estado de la aplicación ──────────────────────────────────────────────────

/** @type {Object[]} Lista completa de llamadas cargadas desde la API */
let llamadas = [];

/** @type {Object[]} Subconjunto filtrado y ordenado de llamadas (se pagina sobre este) */
let llamadasFiltradas = [];

/** @type {number|null} ID de la llamada pendiente de eliminar (usado por el diálogo) */
let pendienteEliminarId = null;

/** @type {number} Página actual de la paginación (base 1) */
let paginaActual = 1;

/** @type {string} Columna activa de ordenación */
let sortCol = "fecha_hora";

/** @type {'asc'|'desc'} Dirección de la ordenación */
let sortDir = "desc";

/**
 * ID de la llamada actualmente en edición.
 * Se usa como fuente de verdad para decidir PUT vs POST aunque el input hidden se limpie.
 * @type {number|null}
 */
let llamadaEditandoId = null;

/** @type {string} Filtro por estado ('' = todos) */
let filtroEstado = "";

/** @type {'todo'|'hoy'|'semana'|'personalizado'} */
let filtroFechaModo = "todo";

// ─── Inicialización ───────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    // En empaquetado, el proceso principal puede proporcionar el puerto real.
    try {
      if (window.electronAPI?.getConfig) {
        const cfg = await window.electronAPI.getConfig();
        if (cfg?.apiBase) API_URL = cfg.apiBase;
      }
    } catch {
      // Fallback a localhost:5000
    }

    cargarTema();
    cargarDefectos();
    if (filtroRangoPersonalizado) {
      filtroRangoPersonalizado.hidden = true;
    }
    cargarLlamadas();
    cargarEstadisticas();

    // Si se restaura la BD, recargar datos
    try {
      window.electronAPI?.onDbRestored?.(() => {
        mostrarExito("Base de datos restaurada. Recargando…");
        paginaActual = 1;
        cargarLlamadas();
        cargarEstadisticas();
      });
    } catch {}
  })();
});

// Recalcular filas visibles al redimensionar la ventana
window.addEventListener("resize", () => {
  paginaActual = 1;
  filtrarYRenderizar();
});

// ─── Paginación dinámica ──────────────────────────────────────────────────────

/**
 * Calcula cuántas filas caben según el alto útil del área principal (no el alto
 * del recuadro de la tabla, que se encoge al contenido y daría mal la paginación).
 * Garantiza un mínimo de 5 filas para evitar paginaciones demasiado pequeñas.
 * @returns {number} Número de filas por página.
 */
function calcularPorPagina() {
  const main = document.querySelector(".main-content");
  if (!main) return 10;
  const pag = document.getElementById("paginacion");
  const cs = getComputedStyle(main);
  const padY =
    (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const gapStr =
    cs.rowGap && cs.rowGap !== "normal" ? cs.rowGap : cs.gap || "8px";
  const rowGap = parseFloat(gapStr) || 8;
  const pagH = pag ? pag.getBoundingClientRect().height : 0;
  const alturaDisponible = main.clientHeight - padY - rowGap - pagH;
  const alturaCabecera = 44; // thead ≈ 44px
  const filas = Math.floor((alturaDisponible - alturaCabecera) / FILA_ALTURA);
  return Math.max(5, filas);
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

// Panel lateral
btnNuevaLlamada.addEventListener("click", abrirPanelNueva);
closePanel.addEventListener("click", cerrarPanel);
cancelBtn.addEventListener("click", cerrarPanel);
panelOverlay.addEventListener("click", cerrarPanel);
formLlamada.addEventListener("submit", guardarLlamada);

// Botón "Ahora": rellena fecha/hora con el momento actual
btnAhora.addEventListener("click", () => {
  const ahora = new Date();
  ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
  document.getElementById("fecha_hora").value = ahora.toISOString().slice(0, 16);
});

// Validación de teléfono en tiempo real
document.getElementById("numero_telefono").addEventListener("input", (e) => {
  validarTelefono(e.target.value);
});

// Omitir teléfono (oculta campo + no valida + no exige)
chkSinTelefono?.addEventListener("change", () => {
  _aplicarModoSinTelefono(chkSinTelefono.checked);
});

// Búsqueda en tiempo real (filtra mientras se escribe)
busquedaInput.addEventListener("input", () => {
  paginaActual = 1;
  filtrarYRenderizar();
});

// Chips: estado
filtroEstadoChips?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-estado]");
  if (!btn) return;
  filtroEstado = btn.getAttribute("data-estado") || "";
  filtroEstadoChips.querySelectorAll(".filter-chip").forEach((b) =>
    b.classList.toggle("activa", b === btn)
  );
  paginaActual = 1;
  filtrarYRenderizar();
});

// Chips: rango de fechas
filtroFechaChips?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-fecha]");
  if (!btn) return;
  filtroFechaModo = btn.getAttribute("data-fecha") || "todo";
  filtroFechaChips.querySelectorAll(".filter-chip").forEach((b) =>
    b.classList.toggle("activa", b === btn)
  );
  if (filtroFechaModo === "personalizado") {
    filtroRangoPersonalizado.hidden = false;
    const hoy = new Date();
    const y = hoy.getFullYear();
    const m = String(hoy.getMonth() + 1).padStart(2, "0");
    const d = String(hoy.getDate()).padStart(2, "0");
    const ymd = `${y}-${m}-${d}`;
    if (!filtroFechaDesde.value) filtroFechaDesde.value = ymd;
    if (!filtroFechaHasta.value) filtroFechaHasta.value = ymd;
  } else if (filtroRangoPersonalizado) {
    filtroRangoPersonalizado.hidden = true;
  }
  paginaActual = 1;
  filtrarYRenderizar();
});

filtroFechaDesde?.addEventListener("change", () => {
  paginaActual = 1;
  filtrarYRenderizar();
});
filtroFechaHasta?.addEventListener("change", () => {
  paginaActual = 1;
  filtrarYRenderizar();
});

// Ordenación por columna al hacer clic en las cabeceras
document.querySelectorAll("th.sortable").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.getAttribute("data-col");

    // Alternar dirección si es la misma columna; si no, ascendente por defecto
    sortDir = sortCol === col && sortDir === "asc" ? "desc" : "asc";
    sortCol = col;

    // Actualizar clases visuales de ordenación
    document.querySelectorAll("th.sortable").forEach((t) =>
      t.classList.remove("sort-asc", "sort-desc")
    );
    th.classList.add(sortDir === "asc" ? "sort-asc" : "sort-desc");

    paginaActual = 1;
    filtrarYRenderizar();
  });
});

// Diálogo de confirmación de eliminación
dialogCancelar.addEventListener("click", () => {
  dialogConfirm.classList.remove("active");
  pendienteEliminarId = null;
});
dialogEliminar.addEventListener("click", () => {
  dialogConfirm.classList.remove("active");
  if (pendienteEliminarId !== null) {
    confirmarEliminar(pendienteEliminarId);
    pendienteEliminarId = null;
  }
});

// Configuración de email por defecto y firma
btnConfigEmail.addEventListener("click", () => {
  inputEmailDefault.value = localStorage.getItem("emailDefault") || "";
  inputFirmaEmail.value   = localStorage.getItem("emailFirma")   || "";
  dialogEmail.classList.add("active");
});
dialogEmailCancelar.addEventListener("click", () =>
  dialogEmail.classList.remove("active")
);
dialogEmailGuardar.addEventListener("click", () => {
  localStorage.setItem("emailDefault", inputEmailDefault.value.trim());
  localStorage.setItem("emailFirma",   inputFirmaEmail.value);
  dialogEmail.classList.remove("active");
  mostrarExito("Configuración de correo guardada");
});

// Modo oscuro / claro
btnModoOscuro.addEventListener("click", toggleModoOscuro);

// Datos / Backups
btnDatos?.addEventListener("click", async () => {
  try {
    await window.electronAPI.openDataFolder();
    mostrarExito("Carpeta de datos abierta");
  } catch (e) {
    mostrarError(`No se pudo abrir la carpeta: ${e?.message || "error"}`);
  }
});

btnBackup?.addEventListener("click", async () => {
  try {
    const ok = await window.electronAPI.exportBackup();
    if (ok) mostrarExito("Backup exportado correctamente");
  } catch (e) {
    mostrarError(`No se pudo exportar el backup: ${e?.message || "error"}`);
  }
});

btnRestore?.addEventListener("click", () => {
  dialogRestore?.classList.add("active");
});

dialogRestoreCancelar?.addEventListener("click", () => {
  dialogRestore?.classList.remove("active");
});

dialogRestoreConfirmar?.addEventListener("click", async () => {
  dialogRestore?.classList.remove("active");
  try {
    const ok = await window.electronAPI.restoreBackup();
    if (ok) mostrarExito("Backup restaurado");
  } catch (e) {
    mostrarError(`No se pudo restaurar: ${e?.message || "error"}`);
  }
});

// Exportar CSV
btnExportarCSV.addEventListener("click", exportarCSV);

// Delegación de eventos en la tabla (email, duplicar, editar, eliminar)
llamadasBody.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const row    = btn.closest("tr");
  if (!row) return;
  const id     = parseInt(row.getAttribute("data-id"), 10);
  const action = btn.getAttribute("data-action");

  switch (action) {
    case "email":     enviarCorreo(id);     break;
    case "edit":      abrirPanelEditar(id); break;
    case "delete":    eliminarLlamada(id);  break;
  }
});

// Atajos de teclado (captura para poder usar preventDefault antes del comportamiento por defecto)
document.addEventListener(
  "keydown",
  (e) => {
    const key = e.key;
    const mod = e.ctrlKey || e.metaKey;

    if (key === "Escape") {
      if (dialogRestore?.classList.contains("active")) {
        e.preventDefault();
        dialogRestoreCancelar?.click();
        return;
      }
      if (dialogConfirm.classList.contains("active")) {
        e.preventDefault();
        dialogCancelar.click();
        return;
      }
      if (dialogEmail.classList.contains("active")) {
        e.preventDefault();
        dialogEmailCancelar.click();
        return;
      }
      if (panel.classList.contains("active")) {
        e.preventDefault();
        cerrarPanel();
      }
      return;
    }

    const modalAbierto =
      (dialogRestore?.classList.contains("active") ?? false) ||
      dialogConfirm.classList.contains("active") ||
      dialogEmail.classList.contains("active");

    if (mod && key.toLowerCase() === "n") {
      if (modalAbierto) return;
      const t = e.target;
      if (
        t &&
        (t.closest?.("#formLlamada") ||
          t.closest?.("#dialogEmail") ||
          t.closest?.("#dialogRestore"))
      )
        return;
      e.preventDefault();
      abrirPanelNueva();
      return;
    }

    if (modalAbierto) return;

    if (mod && key.toLowerCase() === "f") {
      e.preventDefault();
      busquedaInput?.focus();
      try {
        busquedaInput?.select();
      } catch {
        /* select en algunos tipos de input puede fallar */
      }
      return;
    }

    if (key === "/" && !mod && !_enCampoTextoQueNoEsBusqueda(e.target)) {
      e.preventDefault();
      busquedaInput?.focus();
    }
  },
  true
);

// ─── Carga de datos ───────────────────────────────────────────────────────────

/**
 * Obtiene todas las llamadas de la API y actualiza la tabla.
 * Muestra un error de conexión si el backend no está disponible.
 */
async function cargarLlamadas() {
  try {
    const res = await fetch(`${API_URL}/llamadas`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    llamadas = await res.json();
    filtrarYRenderizar();
  } catch {
    mostrarError("No se pudo conectar con el servidor. ¿Está corriendo el backend?");
  }
}

/**
 * Obtiene las estadísticas (hoy / semana / mes / total) y actualiza la barra.
 * Los errores se ignoran silenciosamente para no interrumpir la UX.
 */
async function cargarEstadisticas() {
  try {
    const res = await fetch(`${API_URL}/estadisticas`);
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById("statHoy").textContent    = data.hoy;
    document.getElementById("statSemana").textContent = data.semana;
    document.getElementById("statMes").textContent    = data.mes;
    document.getElementById("statTotal").textContent  = data.total;
  } catch { /* silencioso */ }
}

// ─── Filtrado, ordenación y renderizado ──────────────────────────────────────

/**
 * @returns {{ start: Date, end: Date }}
 */
function _inicioFinHoyLocal() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start, end };
}

/**
 * Semana calendario: lunes–domingo (hora local) que contiene la fecha actual.
 * @returns {{ start: Date, end: Date }}
 */
function _inicioFinSemanaLocal() {
  const now = new Date();
  const dow = now.getDay();
  const diffLunes = (dow + 6) % 7;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffLunes, 0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
  return { start, end };
}

/**
 * @param {string} ymd — YYYY-MM-DD
 * @returns {Date}
 */
function _parseYMDLocal(ymd) {
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(y, mo - 1, d, 0, 0, 0, 0);
}

/**
 * @param {Object} l — llamada
 * @returns {boolean}
 */
function _pasaFiltroFecha(l) {
  if (filtroFechaModo === "todo") return true;
  const t = new Date(l.fecha_hora);
  if (Number.isNaN(t.getTime())) return false;
  if (filtroFechaModo === "hoy") {
    const { start, end } = _inicioFinHoyLocal();
    return t >= start && t <= end;
  }
  if (filtroFechaModo === "semana") {
    const { start, end } = _inicioFinSemanaLocal();
    return t >= start && t <= end;
  }
  if (filtroFechaModo === "personalizado") {
    const desde = filtroFechaDesde?.value?.trim();
    const hasta = filtroFechaHasta?.value?.trim();
    if (!desde || !hasta) return true;
    const ds = _parseYMDLocal(desde);
    const hend = _parseYMDLocal(hasta);
    hend.setHours(23, 59, 59, 999);
    const solo = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, 0, 0, 0);
    return solo >= ds && solo <= hend;
  }
  return true;
}

function _hayFiltrosActivos() {
  if (busquedaInput.value.trim()) return true;
  if (filtroEstado) return true;
  if (filtroFechaModo !== "todo") return true;
  return false;
}

/**
 * Aplica el filtro de búsqueda y la ordenación activa, luego renderiza
 * la tabla y la paginación. Llamar siempre que cambie datos, búsqueda u orden.
 */
function filtrarYRenderizar() {
  const q = busquedaInput.value.toLowerCase().trim();

  llamadasFiltradas = llamadas.filter((l) => {
    const pasaTexto = [l.nombre_llamante, l.numero_telefono, l.motivo, l.notas].some((campo) =>
      (campo || "").toLowerCase().includes(q)
    );
    if (!pasaTexto) return false;
    if (filtroEstado) {
      const est = l.estado || "Atendida";
      if (est !== filtroEstado) return false;
    }
    if (!_pasaFiltroFecha(l)) return false;
    return true;
  });

  // Ordenar
  llamadasFiltradas.sort((a, b) => {
    let va = a[sortCol] ?? "";
    let vb = b[sortCol] ?? "";

    if (sortCol === "fecha_hora") {
      va = new Date(va);
      vb = new Date(vb);
    } else {
      va = String(va).toLowerCase();
      vb = String(vb).toLowerCase();
    }

    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ?  1 : -1;
    return 0;
  });

  renderizarTabla();
  renderizarPaginacion();
}

/**
 * Construye las filas de la tabla para la página actual.
 * Usa createElement (no innerHTML en filas) para evitar XSS y problemas de foco.
 */
function renderizarTabla() {
  // Limpiar filas anteriores
  while (llamadasBody.firstChild) llamadasBody.removeChild(llamadasBody.firstChild);

  if (llamadasFiltradas.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "empty-state";
    const td = document.createElement("td");
    td.colSpan = 7;
    if (_hayFiltrosActivos()) {
      td.textContent = "No hay resultados con estos filtros";
    } else {
      td.textContent = "No hay llamadas registradas";
    }
    tr.appendChild(td);
    llamadasBody.appendChild(tr);
    return;
  }

  const porPagina = calcularPorPagina();
  const inicio    = (paginaActual - 1) * porPagina;
  const pagina    = llamadasFiltradas.slice(inicio, inicio + porPagina);

  // Mapa de estado → clase CSS del badge (actuales + valores heredados de BD antigua)
  const BADGE_CLASS = {
    Atendida:             "badge-pendiente",
    Finalizada:           "badge-resuelto",
    "Enviada por correo": "badge-seguimiento",
    Pendiente:            "badge-pendiente",
    Resuelto:             "badge-resuelto",
    Seguimiento:          "badge-seguimiento",
  };

  pagina.forEach((llamada) => {
    const tr = document.createElement("tr");
    tr.setAttribute("data-id", llamada.id);

    const fecha      = new Date(llamada.fecha_hora).toLocaleString("es-ES");
    const badgeClass = BADGE_CLASS[llamada.estado] || "badge-pendiente";
    const notas      = (llamada.notas || "-").replace(/\n/g, " ");
    const nombre     = llamada.nombre_llamante || "";
    const telefono   = (llamada.numero_telefono || "").trim();
    const celdaTel = telefono
      ? `<td title="${_esc(telefono)}">${_esc(telefono)}</td>`
      : `<td title="Sin teléfono registrado"><span class="tel-missing">📵 Sin tel.</span></td>`;
    const motivo     = llamada.motivo || "-";
    const estado     = llamada.estado || "Atendida";

    // innerHTML solo en el contenido de la fila (no en botones de acción)
    tr.innerHTML = `
      <td title="${_esc(nombre)}">${_esc(nombre)}</td>
      ${celdaTel}
      <td title="${_esc(motivo)}">${_esc(motivo)}</td>
      <td class="notas-column" title="${_esc(llamada.notas || "")}">
        <div class="nota-cell">
          <div class="nota-text">${_esc(notas)}</div>
        </div>
      </td>
      <td title="${_esc(estado)}"><span class="badge ${badgeClass}">${_esc(estado)}</span></td>
      <td title="${_esc(fecha)}">${_esc(fecha)}</td>
      <td>
        <button class="btn btn-email btn-small"     data-action="email"     type="button" title="Enviar correo">📧</button>
        <button class="btn btn-edit btn-small"      data-action="edit"      type="button" title="Editar">✏️</button>
        <button class="btn btn-delete btn-small"    data-action="delete"    type="button" title="Eliminar">🗑️</button>
      </td>
    `;
    llamadasBody.appendChild(tr);
  });
}

/**
 * Construye los botones de paginación con puntos suspensivos para listas largas.
 * No se muestra si hay una sola página.
 */
function renderizarPaginacion() {
  while (paginacionDiv.firstChild) paginacionDiv.removeChild(paginacionDiv.firstChild);

  const porPagina   = calcularPorPagina();
  const totalPaginas = Math.ceil(llamadasFiltradas.length / porPagina);
  if (totalPaginas <= 1) return;

  /** @param {string|number} texto @param {number} pagina @param {boolean} activa */
  const crearBtn = (texto, pagina, activa = false) => {
    const btn = document.createElement("button");
    btn.textContent = texto;
    if (activa) btn.classList.add("activa");
    btn.addEventListener("click", () => {
      paginaActual = pagina;
      renderizarTabla();
      renderizarPaginacion();
    });
    return btn;
  };

  if (paginaActual > 1)
    paginacionDiv.appendChild(crearBtn("← Anterior", paginaActual - 1));

  for (let i = 1; i <= totalPaginas; i++) {
    // Puntos suspensivos para rangos alejados de la página actual
    if (totalPaginas > 7 && i > 2 && i < totalPaginas - 1 && Math.abs(i - paginaActual) > 1) {
      if (i === 3 || i === totalPaginas - 2) {
        const dots = document.createElement("span");
        dots.textContent  = "…";
        dots.style.padding = "6px 4px";
        paginacionDiv.appendChild(dots);
      }
      continue;
    }
    paginacionDiv.appendChild(crearBtn(i, i, i === paginaActual));
  }

  if (paginaActual < totalPaginas)
    paginacionDiv.appendChild(crearBtn("Siguiente →", paginaActual + 1));
}

// ─── Panel lateral ────────────────────────────────────────────────────────────

/**
 * Abre el panel en modo "Nueva llamada" con valores por defecto.
 */
function abrirPanelNueva() {
  llamadaEditandoId = null;
  document.getElementById("llamadaId").value = "";
  formLlamada.reset();
  document.getElementById("panelTitle").textContent = "Nueva Llamada";

  // Fecha/hora actual como valor por defecto
  const ahora = new Date();
  ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
  document.getElementById("fecha_hora").value = ahora.toISOString().slice(0, 16);
  document.getElementById("motivo").value  = "Consulta SAT";
  document.getElementById("estado").value  = "Atendida";

  // Por defecto, pedir teléfono (a menos que el usuario marque "Sin teléfono")
  chkSinTelefono.checked = false;
  _aplicarModoSinTelefono(false);

  _habilitarFormulario();
  panel.classList.add("active");
  setTimeout(() => document.getElementById("nombre_llamante").focus(), 100);
}

/**
 * Abre el panel en modo "Editar" con los datos de la llamada indicada.
 * @param {number} id — ID de la llamada a editar.
 */
function abrirPanelEditar(id) {
  const llamada = llamadas.find((l) => l.id === id);
  if (!llamada) return;

  document.getElementById("panelTitle").textContent    = "Editar Llamada";
  llamadaEditandoId = llamada.id;
  document.getElementById("llamadaId").value           = llamada.id;
  document.getElementById("fecha_hora").value          = llamada.fecha_hora.slice(0, 16);
  document.getElementById("numero_telefono").value     = llamada.numero_telefono;
  document.getElementById("nombre_llamante").value     = llamada.nombre_llamante;
  document.getElementById("motivo").value              = llamada.motivo || "";
  document.getElementById("notas").value               = llamada.notas  || "";
  document.getElementById("estado").value              = llamada.estado  || "Atendida";

  const sinTel = !(llamada.numero_telefono || "").trim();
  chkSinTelefono.checked = sinTel;
  _aplicarModoSinTelefono(sinTel);

  _habilitarFormulario();
  panel.classList.add("active");
  setTimeout(() => document.getElementById("nombre_llamante").focus(), 100);
}

/** Cierra el panel lateral. */
function cerrarPanel() {
  panel.classList.remove("active");
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Maneja el submit del formulario: crea (POST) o actualiza (PUT) una llamada.
 * @param {Event} e — Evento submit del formulario.
 */
async function guardarLlamada(e) {
  e.preventDefault();

  const sinTel = !!chkSinTelefono?.checked;
  if (!sinTel) {
    // Validar teléfono antes de enviar (solo si no se ha omitido)
    const telOk = validarTelefono(document.getElementById("numero_telefono").value);
    if (telOk === false) {
      document.getElementById("numero_telefono").focus();
      return;
    }
  }

  const rawId = String(document.getElementById("llamadaId").value || "").trim();
  const llamadaId = rawId !== "" ? rawId : (llamadaEditandoId !== null ? String(llamadaEditandoId) : "");
  const datos = {
    fecha_hora:       document.getElementById("fecha_hora").value,
    numero_telefono:  sinTel ? "" : document.getElementById("numero_telefono").value,
    nombre_llamante:  document.getElementById("nombre_llamante").value,
    duracion_minutos: 0,
    motivo:           document.getElementById("motivo").value,
    notas:            document.getElementById("notas").value,
    estado:           document.getElementById("estado").value,
  };

  try {
    const url    = llamadaId ? `${API_URL}/llamadas/${llamadaId}` : `${API_URL}/llamadas`;
    const method = llamadaId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(datos),
    });
    if (!res.ok) {
      let detalle = `Error al guardar (${res.status})`;
      try {
        const errBody = await res.json();
        if (errBody?.error) detalle = String(errBody.error);
      } catch { /* cuerpo no JSON */ }
      mostrarError(detalle);
      return;
    }

    cerrarPanel();
    llamadaEditandoId = null;
    await Promise.all([cargarLlamadas(), cargarEstadisticas()]);
    mostrarExito(llamadaId ? "Llamada actualizada" : "Llamada creada");
  } catch (e) {
    mostrarError(e?.message ? `Error al guardar: ${e.message}` : "Error al guardar la llamada");
  }
}

/**
 * Muestra el diálogo de confirmación y guarda el ID pendiente de eliminar.
 * @param {number} id — ID de la llamada a eliminar.
 */
function eliminarLlamada(id) {
  pendienteEliminarId = id;
  dialogConfirm.classList.add("active");
}

/**
 * Ejecuta el DELETE en la API tras la confirmación del usuario.
 * @param {number} id — ID confirmado para eliminar.
 */
async function confirmarEliminar(id) {
  try {
    const res = await fetch(`${API_URL}/llamadas/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await Promise.all([cargarLlamadas(), cargarEstadisticas()]);
    mostrarExito("Llamada eliminada");
  } catch {
    mostrarError("Error al eliminar la llamada");
  }
}

/**
 * Abre el panel pre-rellenado con los datos de una llamada existente,
 * pero sin ID (se guardará como nueva al confirmar).
 * @param {number} id — ID de la llamada a duplicar.
 */
function duplicarLlamada(id) {
  const llamada = llamadas.find((l) => l.id === id);
  if (!llamada) return;

  document.getElementById("panelTitle").textContent    = "Nueva Llamada (copia)";
  llamadaEditandoId = null;
  document.getElementById("llamadaId").value           = "";

  const ahora = new Date();
  ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
  document.getElementById("fecha_hora").value          = ahora.toISOString().slice(0, 16);
  document.getElementById("numero_telefono").value     = llamada.numero_telefono;
  document.getElementById("nombre_llamante").value     = llamada.nombre_llamante;
  document.getElementById("motivo").value              = llamada.motivo || "";
  document.getElementById("notas").value               = llamada.notas  || "";
  document.getElementById("estado").value              = "Atendida";

  const sinTel = !(llamada.numero_telefono || "").trim();
  chkSinTelefono.checked = sinTel;
  _aplicarModoSinTelefono(sinTel);

  _habilitarFormulario();
  panel.classList.add("active");
  setTimeout(() => document.getElementById("nombre_llamante").focus(), 100);
}

// ─── Validación de teléfono ───────────────────────────────────────────────────

/**
 * Valida el número de teléfono y actualiza el estado visual del campo.
 * Acepta formatos: +34 612345678 | 91 234 56 78 | +1 212-555-1234
 *
 * @param {string} valor — Valor actual del input de teléfono.
 * @returns {boolean|undefined}
 *   true  → válido
 *   false → inválido (muestra error)
 *   undefined → vacío (sin estado)
 */
function validarTelefono(valor) {
  const input = document.getElementById("numero_telefono");
  const error = document.getElementById("errorTelefono");
  const regex = /^\+?[\d\s\-().]{7,15}$/;
  const soloDigitos = valor.replace(/\D/g, "");

  input.classList.remove("input-error", "input-ok");
  error.textContent = "";

  if (valor === "") return; // Campo vacío: sin validación visual

  if (!regex.test(valor)) {
    input.classList.add("input-error");
    error.textContent = "Solo se permiten números, espacios, guiones y +";
    return false;
  }
  if (soloDigitos.length < 7) {
    input.classList.add("input-error");
    error.textContent = "El teléfono debe tener al menos 7 dígitos";
    return false;
  }
  if (soloDigitos.length > 15) {
    input.classList.add("input-error");
    error.textContent = "El teléfono no puede tener más de 15 dígitos";
    return false;
  }

  input.classList.add("input-ok");
  return true;
}

// ─── Correo ───────────────────────────────────────────────────────────────────

/**
 * Abre el cliente de correo predeterminado (Outlook, etc.) con los datos
 * de la llamada pre-rellenados en asunto y cuerpo.
 * @param {number} id — ID de la llamada.
 */
async function enviarCorreo(id) {
  const llamada = llamadas.find((l) => l.id === id);
  if (!llamada) return;

  const emailTo = localStorage.getItem("emailDefault") || "";

  try {
    // Usar la API COM de Outlook vía IPC → añade datos + firma automáticamente
    await window.electronAPI.enviarCorreo({
      emailTo,
      asunto:   llamada.motivo          || "Consulta SAT",
      nombre:   llamada.nombre_llamante || "",
      telefono: llamada.numero_telefono || "",
      notas:    llamada.notas           || "",
    });
    // Si el correo se abre correctamente, marcamos el registro como enviado
    // (sin bloquear la UX si el update falla).
    try {
      if (llamada.id && llamada.estado !== "Enviada por correo") {
        await fetch(`${API_URL}/llamadas/${llamada.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: "Enviada por correo" }),
        });
        await Promise.all([cargarLlamadas(), cargarEstadisticas()]);
      }
    } catch { /* silencioso */ }
    mostrarExito("Correo abierto en Outlook");
  } catch (err) {
    console.error("Error al abrir Outlook:", err);
    const msg = err?.message ? `No se pudo abrir Outlook: ${err.message}` : "No se pudo abrir Outlook. ¿Está instalado?";
    mostrarError(msg);
  }
}

// ─── Exportar CSV ─────────────────────────────────────────────────────────────

/**
 * Genera y descarga un archivo CSV con las llamadas actualmente filtradas.
 * Incluye BOM UTF-8 para compatibilidad con Excel.
 */
function exportarCSV() {
  const CABECERA = ["ID", "Nombre", "Teléfono", "Motivo", "Notas", "Estado", "Fecha/Hora"];

  const filas = llamadasFiltradas.map((l) => [
    l.id,
    _csvCell(l.nombre_llamante),
    _csvCell((l.numero_telefono || "").trim() ? l.numero_telefono : "Sin tel."),
    _csvCell(l.motivo),
    _csvCell(l.notas),
    l.estado || "Atendida",
    new Date(l.fecha_hora).toLocaleString("es-ES"),
  ]);

  const csv  = [CABECERA.join(","), ...filas.map((f) => f.join(","))].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `llamadas_SAT_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  mostrarExito("CSV exportado correctamente");
}

// ─── Modo oscuro ──────────────────────────────────────────────────────────────

/** Alterna entre tema claro y oscuro y lo persiste en localStorage. */
function toggleModoOscuro() {
  const html  = document.documentElement;
  const nuevo = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
  html.setAttribute("data-theme", nuevo);
  localStorage.setItem("tema", nuevo);
  btnModoOscuro.textContent = nuevo === "dark" ? "☀️" : "🌙";
}

/**
 * Establece los valores por defecto de localStorage en el primer arranque.
 * Si el usuario ya los modificó, no los sobreescribe.
 */
function cargarDefectos() {
  if (!localStorage.getItem("emailFirma")) {
    localStorage.setItem("emailFirma",
      "Atentamente,\n" +
      "Andrés Donoso\n" +
      "Técnico Superior en ASIR\n" +
      "Servicio de Atención Técnica (SAT)"
    );
  }
}

/** Aplica el tema guardado en localStorage al arrancar la app. */
function cargarTema() {
  const tema = localStorage.getItem("tema") || "light";
  document.documentElement.setAttribute("data-theme", tema);
  btnModoOscuro.textContent = tema === "dark" ? "☀️" : "🌙";
}

// ─── Alertas ──────────────────────────────────────────────────────────────────

/**
 * Muestra una notificación de error temporal en la barra inferior.
 * @param {string} mensaje — Texto a mostrar.
 */
function mostrarError(mensaje) {
  _mostrarAlerta(mensaje, "alerta-error");
}

/**
 * Muestra una notificación de éxito temporal en la barra inferior.
 * @param {string} mensaje — Texto a mostrar.
 */
function mostrarExito(mensaje) {
  _mostrarAlerta(mensaje, "alerta-exito");
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Crea y muestra una alerta temporal. Se elimina automáticamente tras 4 s.
 * @param {string} mensaje — Texto de la alerta.
 * @param {string} clase   — Clase CSS ('alerta-error' | 'alerta-exito').
 */
function _mostrarAlerta(mensaje, clase) {
  const bar = document.getElementById("notificacionesBar");
  const div = document.createElement("div");
  div.className = `alerta ${clase}`;
  div.textContent = mensaje;
  (bar ?? document.body).appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

/**
 * Escapa caracteres HTML para evitar XSS al insertar texto en innerHTML.
 * @param {string} str
 * @returns {string}
 */
function _esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Formatea un valor para una celda CSV (envuelve en comillas y escapa las internas).
 * @param {string|null|undefined} val
 * @returns {string}
 */
function _csvCell(val) {
  return `"${(val || "").replace(/"/g, '""')}"`;
}

/**
 * Elimina el atributo readonly/disabled de todos los campos del formulario.
 * Necesario para garantizar que los inputs son editables al abrir el panel.
 */
function _habilitarFormulario() {
  formLlamada.querySelectorAll("input, textarea, select").forEach((el) => {
    el.readOnly = false;
    el.disabled = false;
  });
}

/**
 * Activa/desactiva el modo "Sin teléfono".
 * - Oculta el campo y elimina el required
 * - Limpia el valor y el estado de validación/error
 * @param {boolean} activo
 */
function _aplicarModoSinTelefono(activo) {
  const input = document.getElementById("numero_telefono");
  const error = document.getElementById("errorTelefono");
  if (!input || !error || !grupoTelefono) return;

  if (activo) {
    input.value = "";
    input.removeAttribute("required");
    input.classList.remove("input-error", "input-ok");
    error.textContent = "";
    grupoTelefono.style.display = "none";
  } else {
    grupoTelefono.style.display = "";
    input.setAttribute("required", "required");
  }
}

/**
 * True si el foco está en un campo donde "/" no debe robar el foco (p. ej. notas, nombre).
 * El cuadro de búsqueda (#busqueda) no cuenta.
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
function _enCampoTextoQueNoEsBusqueda(target) {
  if (!target || !(target instanceof Element)) return false;
  if (target === busquedaInput || target.closest?.("#busqueda") === busquedaInput) return false;
  const el = target.closest?.("input, textarea, select");
  if (target.isContentEditable) return true;
  if (!el) return false;
  if (el === busquedaInput) return false;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "SELECT") return false;
  const type = (el.getAttribute("type") || "text").toLowerCase();
  return ["text", "search", "tel", "email", "url", "password", "number", "datetime-local", "date", "time"].includes(type);
}
