"""
models.py — Modelos de base de datos (SQLAlchemy ORM)

Define la tabla 'llamadas' y el método de serialización JSON.
"""

from sqlalchemy import Column, Integer, String, DateTime, Text
from datetime import datetime
from database import Base


class Llamada(Base):
    """
    Modelo que representa una llamada entrante al SAT.

    Campos:
        id               — Clave primaria autoincremental.
        fecha_hora       — Fecha y hora en que se produjo la llamada.
        numero_telefono  — Número de teléfono del llamante (máx. 15 chars).
        nombre_llamante  — Nombre completo del llamante (máx. 100 chars).
        duracion_minutos — Duración de la llamada en minutos (reservado, por defecto 0).
        motivo           — Motivo o categoría de la llamada (máx. 100 chars).
        notas            — Notas detalladas sobre la llamada (texto libre).
        estado           — Estado del caso: 'Atendida', 'Finalizada' o 'Enviada por correo'.
        created_at       — Timestamp de creación del registro (generado automáticamente).
    """

    __tablename__ = "llamadas"

    id               = Column(Integer, primary_key=True, index=True)
    fecha_hora       = Column(DateTime, default=datetime.now, nullable=False)
    numero_telefono  = Column(String(15), nullable=False)
    nombre_llamante  = Column(String(100), nullable=False)
    duracion_minutos = Column(Integer, default=0)
    motivo           = Column(String(100), default="Consulta SAT")
    notas            = Column(Text)
    estado           = Column(String(30), default="Atendida")
    created_at       = Column(DateTime, default=datetime.now)

    def to_dict(self) -> dict:
        """Serializa la llamada a un diccionario compatible con JSON."""
        return {
            "id":               self.id,
            "fecha_hora":       self.fecha_hora.isoformat() if self.fecha_hora else None,
            "numero_telefono":  self.numero_telefono,
            "nombre_llamante":  self.nombre_llamante,
            "duracion_minutos": self.duracion_minutos,
            "motivo":           self.motivo,
            "notas":            self.notas,
            "estado":           self.estado or "Atendida",
            "created_at":       self.created_at.isoformat() if self.created_at else None,
        }
