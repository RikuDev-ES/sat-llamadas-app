"""Tests mínimos del API REST (sin teléfono, estados)."""


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.get_json().get("status") == "ok"


def test_post_llamada_sin_telefono(client):
    payload = {
        "fecha_hora": "2026-04-29T12:00",
        "numero_telefono": "",
        "nombre_llamante": "Sin tel test",
        "duracion_minutos": 0,
        "motivo": "Consulta SAT",
        "notas": "",
        "estado": "Atendida",
    }
    r = client.post("/api/llamadas", json=payload)
    assert r.status_code == 201, r.get_json()
    data = r.get_json()
    assert data["nombre_llamante"] == "Sin tel test"
    assert data["numero_telefono"] == ""
    assert data["estado"] == "Atendida"


def test_post_llamada_estados_validos(client):
    for estado in ("Atendida", "Finalizada", "Enviada por correo"):
        r = client.post(
            "/api/llamadas",
            json={
                "fecha_hora": "2026-04-29T12:00",
                "numero_telefono": "612345678",
                "nombre_llamante": f"User {estado}",
                "duracion_minutos": 0,
                "motivo": "x",
                "notas": "",
                "estado": estado,
            },
        )
        assert r.status_code == 201, (estado, r.get_json())
        assert r.get_json()["estado"] == estado


def test_post_llamada_estado_invalido(client):
    r = client.post(
        "/api/llamadas",
        json={
            "fecha_hora": "2026-04-29T12:00",
            "numero_telefono": "612345678",
            "nombre_llamante": "Bad state",
            "duracion_minutos": 0,
            "motivo": "x",
            "notas": "",
            "estado": "Pendiente",
        },
    )
    assert r.status_code == 400
    err = r.get_json().get("error", "")
    assert "Atendida" in err or "estado" in err.lower()


def test_post_sin_nombre_obligatorio(client):
    r = client.post(
        "/api/llamadas",
        json={
            "fecha_hora": "2026-04-29T12:00",
            "numero_telefono": "",
            "nombre_llamante": "  ",
            "duracion_minutos": 0,
            "motivo": "x",
            "notas": "",
            "estado": "Atendida",
        },
    )
    assert r.status_code == 400
