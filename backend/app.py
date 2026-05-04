"""
app.py — Servidor Flask con la API REST del Registro de Llamadas SAT.

Rutas disponibles:
    GET    /api/llamadas              → Lista todas las llamadas (orden desc por fecha).
    POST   /api/llamadas              → Crea una nueva llamada.
    GET    /api/llamadas/<id>         → Obtiene una llamada concreta.
    PUT    /api/llamadas/<id>         → Actualiza una llamada existente.
    DELETE /api/llamadas/<id>         → Elimina una llamada.
    GET    /api/estadisticas          → Contadores hoy / semana / mes / total.
    GET    /api/health                → Health-check del servidor.
    POST   /api/admin/prepare-db-restore → Cierra conexiones antes de restaurar datos.db.
    POST   /api/admin/finish-db-restore  → Tras restaurar, fuerza reconexión al archivo.

Configuración:
    - Host:  127.0.0.1 (solo acceso local)
    - Puerto: 5000 (por defecto) o SAT_BACKEND_PORT
    - CORS restringido a orígenes locales (Electron suele enviar Origin: null)
"""

import logging
import os
import re
from datetime import datetime, timedelta

from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlalchemy

from database import engine, SessionLocal, Base
from models import Llamada

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ─── Aplicación Flask ─────────────────────────────────────────────────────────
app = Flask(__name__)
# Electron (file://) envía Origin: null. Permitimos solo orígenes locales.
CORS(
    app,
    resources={r"/api/*": {"origins": ["null", "http://localhost", "http://127.0.0.1"]}},
)

# ─── Inicialización de la BD ──────────────────────────────────────────────────
Base.metadata.create_all(bind=engine)
logger.info("Base de datos lista en: %s", engine.url)

# Migración automática (segura): agrega la columna 'estado' si no existe (DBs antiguas)
with engine.connect() as conn:
    try:
        cols = conn.execute(sqlalchemy.text("PRAGMA table_info(llamadas)")).fetchall()
        col_names = {c[1] for c in cols}  # (cid, name, type, notnull, dflt_value, pk)
        if "estado" not in col_names:
            conn.execute(
                sqlalchemy.text(
                    "ALTER TABLE llamadas ADD COLUMN estado VARCHAR(20) DEFAULT 'Pendiente'"
                )
            )
            conn.commit()
            logger.info("Migración: columna 'estado' añadida.")
    except Exception as e:
        logger.warning("Migración no aplicada: %s", e)


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _parse_datetime(value: str) -> datetime:
    """Convierte una cadena ISO 8601 a datetime. Usa 'ahora' si falla."""
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return datetime.now()


_ESTADOS_VALIDOS = {"Atendida", "Finalizada", "Enviada por correo"}

# Límite de notas (Text en SQLite; evita payloads enormes)
_NOTAS_MAX_LEN = 50_000


def _validar_llamada_payload(data: dict, parcial: bool) -> tuple[bool, str]:
    """
    Valida payload de llamada.
    - parcial=True: permite campos omitidos (PUT)
    - parcial=False: exige campos mínimos (POST)
    """
    def req(field: str) -> bool:
        return field in data and str(data.get(field, "")).strip() != ""

    if not parcial:
        if not req("nombre_llamante"):
            return False, "El campo 'nombre_llamante' es obligatorio"

    if "numero_telefono" in data:
        tel = str(data.get("numero_telefono") or "").strip()
        if tel != "":
            digits = re.sub(r"\D", "", tel)
            if len(digits) < 7 or len(digits) > 15:
                return False, "El teléfono debe tener entre 7 y 15 dígitos"

    if "estado" in data:
        est = str(data.get("estado") or "").strip()
        if est and est not in _ESTADOS_VALIDOS:
            return False, "El estado debe ser: Atendida, Finalizada o Enviada por correo"

    # Límites básicos para evitar entradas absurdamente grandes
    for field, max_len in (("nombre_llamante", 100), ("motivo", 100), ("numero_telefono", 30)):
        if field in data and data.get(field) is not None:
            if len(str(data[field])) > max_len:
                return False, f"El campo '{field}' supera {max_len} caracteres"

    if "notas" in data and data.get("notas") is not None:
        if len(str(data["notas"])) > _NOTAS_MAX_LEN:
            return False, f"El campo 'notas' supera {_NOTAS_MAX_LEN} caracteres"

    if "duracion_minutos" in data:
        dm = data.get("duracion_minutos")
        if dm is not None:
            try:
                mins = int(dm)
                if mins < 0 or mins > 24 * 60:
                    return False, "La duración debe estar entre 0 y 1440 minutos"
            except (TypeError, ValueError):
                return False, "La duración debe ser un número entero"

    return True, ""


# ─── Rutas: Llamadas ──────────────────────────────────────────────────────────
@app.route("/api/llamadas", methods=["GET"])
def get_llamadas():
    """Devuelve todas las llamadas ordenadas de más reciente a más antigua."""
    db = SessionLocal()
    try:
        llamadas = db.query(Llamada).order_by(Llamada.fecha_hora.desc()).all()
        return jsonify([l.to_dict() for l in llamadas])
    except Exception as e:
        logger.error("Error al obtener llamadas: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/llamadas/<int:llamada_id>", methods=["GET"])
def get_llamada(llamada_id: int):
    """Devuelve una llamada por su ID."""
    db = SessionLocal()
    try:
        llamada = db.query(Llamada).filter(Llamada.id == llamada_id).first()
        if not llamada:
            return jsonify({"error": "Llamada no encontrada"}), 404
        return jsonify(llamada.to_dict())
    except Exception as e:
        logger.error("Error al obtener llamada %d: %s", llamada_id, e)
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/llamadas", methods=["POST"])
def create_llamada():
    """Crea una nueva llamada. Devuelve el registro creado con código 201."""
    db = SessionLocal()
    try:
        data = request.get_json(force=True)
        ok, msg = _validar_llamada_payload(data or {}, parcial=False)
        if not ok:
            return jsonify({"error": msg}), 400
        dm_raw = data.get("duracion_minutos", 0)
        duracion_minutos = 0 if dm_raw is None else int(dm_raw)

        nueva = Llamada(
            fecha_hora       = _parse_datetime(data.get("fecha_hora")),
            numero_telefono  = data.get("numero_telefono", ""),
            nombre_llamante  = data.get("nombre_llamante", ""),
            duracion_minutos = duracion_minutos,
            motivo           = data.get("motivo", "Consulta SAT"),
            notas            = data.get("notas", ""),
            estado           = data.get("estado", "Atendida"),
        )
        db.add(nueva)
        db.commit()
        db.refresh(nueva)
        logger.info("Llamada creada: id=%d, llamante=%s", nueva.id, nueva.nombre_llamante)
        return jsonify(nueva.to_dict()), 201
    except Exception as e:
        db.rollback()
        logger.error("Error al crear llamada: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/llamadas/<int:llamada_id>", methods=["PUT"])
def update_llamada(llamada_id: int):
    """Actualiza los campos proporcionados de una llamada existente."""
    db = SessionLocal()
    try:
        llamada = db.query(Llamada).filter(Llamada.id == llamada_id).first()
        if not llamada:
            return jsonify({"error": "Llamada no encontrada"}), 404

        data = request.get_json(force=True)
        ok, msg = _validar_llamada_payload(data or {}, parcial=True)
        if not ok:
            return jsonify({"error": msg}), 400

        # Solo actualiza los campos presentes en el body
        if "fecha_hora"       in data: llamada.fecha_hora       = _parse_datetime(data["fecha_hora"])
        if "numero_telefono"  in data: llamada.numero_telefono  = data["numero_telefono"]
        if "nombre_llamante"  in data: llamada.nombre_llamante  = data["nombre_llamante"]
        if "duracion_minutos" in data:
            dm_raw = data["duracion_minutos"]
            llamada.duracion_minutos = 0 if dm_raw is None else int(dm_raw)
        if "motivo"           in data: llamada.motivo           = data["motivo"]
        if "notas"            in data: llamada.notas            = data["notas"]
        if "estado"           in data: llamada.estado           = data["estado"]

        db.commit()
        db.refresh(llamada)
        logger.info("Llamada actualizada: id=%d", llamada_id)
        return jsonify(llamada.to_dict())
    except Exception as e:
        db.rollback()
        logger.error("Error al actualizar llamada %d: %s", llamada_id, e)
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/llamadas/<int:llamada_id>", methods=["DELETE"])
def delete_llamada(llamada_id: int):
    """Elimina una llamada por su ID."""
    db = SessionLocal()
    try:
        llamada = db.query(Llamada).filter(Llamada.id == llamada_id).first()
        if not llamada:
            return jsonify({"error": "Llamada no encontrada"}), 404
        db.delete(llamada)
        db.commit()
        logger.info("Llamada eliminada: id=%d", llamada_id)
        return jsonify({"message": "Llamada eliminada"}), 200
    except Exception as e:
        db.rollback()
        logger.error("Error al eliminar llamada %d: %s", llamada_id, e)
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ─── Ruta: Estadísticas ───────────────────────────────────────────────────────
@app.route("/api/estadisticas", methods=["GET"])
def get_estadisticas():
    """
    Devuelve contadores de llamadas agrupadas por período:
        hoy    — desde las 00:00 del día actual.
        semana — desde el lunes de la semana actual.
        mes    — desde el día 1 del mes actual.
        total  — todas las llamadas.
    """
    db = SessionLocal()
    try:
        ahora  = datetime.now()
        inicio_hoy    = ahora.replace(hour=0, minute=0, second=0, microsecond=0)
        inicio_semana = inicio_hoy - timedelta(days=ahora.weekday())
        inicio_mes    = inicio_hoy.replace(day=1)

        return jsonify({
            "total":  db.query(Llamada).count(),
            "hoy":    db.query(Llamada).filter(Llamada.fecha_hora >= inicio_hoy).count(),
            "semana": db.query(Llamada).filter(Llamada.fecha_hora >= inicio_semana).count(),
            "mes":    db.query(Llamada).filter(Llamada.fecha_hora >= inicio_mes).count(),
        })
    except Exception as e:
        logger.error("Error al obtener estadísticas: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ─── Rutas admin (solo localhost; usadas al restaurar datos.db) ───────────────
@app.route("/api/admin/prepare-db-restore", methods=["POST"])
def prepare_db_restore():
    """
    Cierra el pool de conexiones y vuelca el WAL antes de sustituir datos.db
    desde fuera (p. ej. Electron). Sin esto, Flask seguiría leyendo la BD antigua.
    """
    try:
        with engine.begin() as conn:
            conn.execute(sqlalchemy.text("PRAGMA wal_checkpoint(TRUNCATE)"))
    except Exception as e:
        logger.warning("prepare_db_restore (checkpoint): %s", e)
    try:
        engine.dispose()
    except Exception as e:
        logger.warning("prepare_db_restore (dispose): %s", e)
    return jsonify({"ok": True}), 200


@app.route("/api/admin/finish-db-restore", methods=["POST"])
def finish_db_restore():
    """Tras copiar el nuevo datos.db, fuerza conexiones nuevas al archivo actual."""
    try:
        engine.dispose()
    except Exception as e:
        logger.warning("finish_db_restore: %s", e)
    return jsonify({"ok": True}), 200


# ─── Ruta: Health-check ───────────────────────────────────────────────────────
@app.route("/api/health", methods=["GET"])
def health():
    """Endpoint de comprobación de estado. Usado por Electron al arrancar."""
    return jsonify({"status": "ok"}), 200


# ─── Punto de entrada ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("SAT_BACKEND_PORT", "5000"))
    logger.info("Iniciando servidor Flask en http://127.0.0.1:%d", port)
    app.run(debug=False, host="127.0.0.1", port=port)
