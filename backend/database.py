"""
database.py — Configuración de la conexión a SQLite con SQLAlchemy.

La base de datos se almacena por defecto en una ruta de usuario escribible:
  - Windows: %APPDATA%/SAT Llamadas/datos.db (si APPDATA existe)
  - Otros:   ~/.sat-llamadas/datos.db

Se puede forzar una ubicación concreta con la variable de entorno:
  SAT_DB_PATH=/ruta/absoluta/datos.db
"""

import os
import sys
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base


def _get_db_path() -> str:
    """
    Devuelve la ruta absoluta al archivo datos.db.

    Prioridad:
      1) SAT_DB_PATH (si existe)
      2) Ruta de usuario (APPDATA o HOME)
    """
    env_path = os.environ.get("SAT_DB_PATH")
    if env_path:
        return os.path.abspath(env_path)

    appdata = os.environ.get("APPDATA")
    if appdata:
        base_dir = os.path.join(appdata, "SAT Llamadas")
    else:
        base_dir = os.path.join(os.path.expanduser("~"), ".sat-llamadas")

    os.makedirs(base_dir, exist_ok=True)
    return os.path.join(base_dir, "datos.db")


DB_PATH = _get_db_path()
DATABASE_URL = f"sqlite:///{DB_PATH}"

# Motor SQLAlchemy — check_same_thread=False necesario para Flask multi-hilo
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

# Endurecer SQLite: WAL reduce riesgo en apagones, busy_timeout evita "database is locked"
@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_connection, _connection_record):
    try:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.execute("PRAGMA busy_timeout=5000;")
        cursor.close()
    except Exception:
        # Si algo falla aquí, SQLite seguirá con valores por defecto
        pass

# Fábrica de sesiones
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base declarativa compartida con los modelos
Base = declarative_base()


def get_db():
    """
    Generador de sesión de base de datos para inyección de dependencias.
    Garantiza que la sesión se cierra aunque ocurra una excepción.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
