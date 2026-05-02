"""
Configuración de pytest: BD temporal vía SAT_DB_PATH antes de importar la app.
"""

from __future__ import annotations

import os
import tempfile

import pytest

_fd, _TEST_DB_PATH = tempfile.mkstemp(suffix=".db")
os.close(_fd)
os.environ["SAT_DB_PATH"] = _TEST_DB_PATH

from app import app as flask_app


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    with flask_app.test_client() as c:
        yield c


def pytest_sessionfinish(session, exitstatus):
    try:
        os.unlink(_TEST_DB_PATH)
    except OSError:
        pass
