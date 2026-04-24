import requests
from datetime import datetime, timedelta
import random

API = "http://localhost:5000/api/llamadas"

datos = [
    {
        "nombre_llamante": "Juan García",
        "numero_telefono": "612 345 678",
        "motivo": "Consulta SAT",
        "notas": "El cliente pregunta sobre su declaración de la renta. Necesita información sobre deducciones.",
        "estado": "Resuelto",
        "fecha_hora": (datetime.now() - timedelta(hours=1)).isoformat(),
    },
    {
        "nombre_llamante": "María López",
        "numero_telefono": "91 234 56 78",
        "motivo": "Reclamación",
        "notas": "Tiene una multa que no reconoce. Dice que pagó a tiempo. Hay que revisar el expediente 2024-445.",
        "estado": "Seguimiento",
        "fecha_hora": (datetime.now() - timedelta(hours=3)).isoformat(),
    },
    {
        "nombre_llamante": "Carlos Martínez",
        "numero_telefono": "+34 666 111 222",
        "motivo": "Consulta SAT",
        "notas": "Pregunta sobre el modelo 303 de IVA trimestral.",
        "estado": "Resuelto",
        "fecha_hora": (datetime.now() - timedelta(days=1)).isoformat(),
    },
    {
        "nombre_llamante": "Ana Rodríguez",
        "numero_telefono": "93 456 78 90",
        "motivo": "Cita previa",
        "notas": "Quiere pedir cita para entregar documentación en persona.",
        "estado": "Pendiente",
        "fecha_hora": (datetime.now() - timedelta(days=1, hours=2)).isoformat(),
    },
    {
        "nombre_llamante": "Pedro Sánchez",
        "numero_telefono": "677 888 999",
        "motivo": "Consulta SAT",
        "notas": "Autónomo con dudas sobre el IRPF y gastos deducibles para 2025.",
        "estado": "Seguimiento",
        "fecha_hora": (datetime.now() - timedelta(days=2)).isoformat(),
    },
    {
        "nombre_llamante": "Laura Fernández",
        "numero_telefono": "654 321 098",
        "motivo": "Reclamación",
        "notas": "Cobro duplicado en su cuenta. Solicita devolución urgente.",
        "estado": "Pendiente",
        "fecha_hora": (datetime.now() - timedelta(days=3)).isoformat(),
    },
    {
        "nombre_llamante": "Antonio Jiménez",
        "numero_telefono": "91 987 65 43",
        "motivo": "Información general",
        "notas": "Pregunta sobre plazos de presentación del modelo 100.",
        "estado": "Resuelto",
        "fecha_hora": (datetime.now() - timedelta(days=4)).isoformat(),
    },
    {
        "nombre_llamante": "Isabel Torres",
        "numero_telefono": "+34 699 000 111",
        "motivo": "Consulta SAT",
        "notas": "Empresa nueva, necesita saber qué impuestos debe presentar el primer trimestre.",
        "estado": "Seguimiento",
        "fecha_hora": (datetime.now() - timedelta(days=5)).isoformat(),
    },
    {
        "nombre_llamante": "Roberto Morales",
        "numero_telefono": "688 444 555",
        "motivo": "Error en notificación",
        "notas": "Recibió una notificación con datos incorrectos. Nombre mal escrito en el expediente.",
        "estado": "Pendiente",
        "fecha_hora": (datetime.now() - timedelta(days=6)).isoformat(),
    },
    {
        "nombre_llamante": "Sofía Ruiz",
        "numero_telefono": "96 123 45 67",
        "motivo": "Consulta SAT",
        "notas": "Herencia recibida este año, necesita saber si tiene que hacer alguna declaración extra.",
        "estado": "Resuelto",
        "fecha_hora": (datetime.now() - timedelta(days=7)).isoformat(),
    },
    {
        "nombre_llamante": "David Navarro",
        "numero_telefono": "672 333 444",
        "motivo": "Cita previa",
        "notas": "Pide cita para asesoría sobre inicio de actividad como autónomo.",
        "estado": "Resuelto",
        "fecha_hora": (datetime.now() - timedelta(days=8)).isoformat(),
    },
    {
        "nombre_llamante": "Elena Castillo",
        "numero_telefono": "95 234 56 78",
        "motivo": "Reclamación",
        "notas": "No está de acuerdo con la liquidación provisional. Quiere presentar alegaciones.",
        "estado": "Seguimiento",
        "fecha_hora": (datetime.now() - timedelta(days=9)).isoformat(),
    },
]

print("Insertando datos de prueba...")
ok = 0
for d in datos:
    d["duracion_minutos"] = 0
    try:
        r = requests.post(API, json=d)
        if r.status_code == 201:
            print(f"  ✅ {d['nombre_llamante']}")
            ok += 1
        else:
            print(f"  ❌ {d['nombre_llamante']} — {r.text}")
    except Exception as e:
        print(f"  ❌ Error: {e}")

print(f"\n{ok}/{len(datos)} registros insertados correctamente.")
