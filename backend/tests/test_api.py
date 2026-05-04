"""Tests mínimos del API REST (sin teléfono, estados)."""


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.get_json().get("status") == "ok"


def test_admin_prepare_and_finish_db_restore(client):
    r1 = client.post("/api/admin/prepare-db-restore")
    assert r1.status_code == 200
    assert r1.get_json().get("ok") is True
    r2 = client.post("/api/admin/finish-db-restore")
    assert r2.status_code == 200
    assert r2.get_json().get("ok") is True


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


def test_post_notas_demasiado_largas(client):
    r = client.post(
        "/api/llamadas",
        json={
            "fecha_hora": "2026-04-29T12:00",
            "numero_telefono": "612345678",
            "nombre_llamante": "Test",
            "duracion_minutos": 0,
            "motivo": "x",
            "notas": "x" * 50_001,
            "estado": "Atendida",
        },
    )
    assert r.status_code == 400
    assert "notas" in r.get_json().get("error", "").lower()


def test_post_duracion_invalida(client):
    r = client.post(
        "/api/llamadas",
        json={
            "fecha_hora": "2026-04-29T12:00",
            "numero_telefono": "612345678",
            "nombre_llamante": "Test",
            "duracion_minutos": "no-es-numero",
            "motivo": "x",
            "notas": "",
            "estado": "Atendida",
        },
    )
    assert r.status_code == 400


def test_put_duracion_null_es_cero(client):
    r1 = client.post(
        "/api/llamadas",
        json={
            "fecha_hora": "2026-04-29T12:00",
            "numero_telefono": "612345678",
            "nombre_llamante": "Dur cero",
            "duracion_minutos": 30,
            "motivo": "x",
            "notas": "",
            "estado": "Atendida",
        },
    )
    assert r1.status_code == 201
    lid = r1.get_json()["id"]
    r2 = client.put(
        f"/api/llamadas/{lid}",
        json={"duracion_minutos": None},
    )
    assert r2.status_code == 200
    assert r2.get_json()["duracion_minutos"] == 0
