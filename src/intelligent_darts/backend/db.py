"""Lakebase (PostgreSQL) connection manager with automatic token refresh."""
from __future__ import annotations

import socket
import time
from contextlib import contextmanager
from typing import Generator

import psycopg
from databricks.sdk import WorkspaceClient

from .config import AppConfig
from .logger import logger

_DB_NAME = "databricks_postgres"
_TOKEN_TTL_SEC = 3300  # refresh ~5 min before the 1-hour expiry


class DbManager:
    """Manages a Lakebase Postgres connection with automatic OAuth token refresh.

    Usage:
        with db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
    """

    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self._ws = WorkspaceClient()
        self._token: str | None = None
        self._token_expires_at: float = 0.0
        self._user: str | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.config.lakebase_host and self.config.lakebase_endpoint)

    def _get_user(self) -> str:
        if self._user is None:
            self._user = self._ws.current_user.me().user_name
        return self._user

    def _fresh_token(self) -> str:
        now = time.monotonic()
        if self._token is None or now >= self._token_expires_at:
            endpoint = self.config.lakebase_endpoint
            if not endpoint:
                raise RuntimeError("Lakebase endpoint not configured (INTELLIGENT_DARTS_LAKEBASE_PROJECT)")
            cred = self._ws.postgres.generate_database_credential(endpoint=endpoint)
            self._token = cred.token
            self._token_expires_at = now + _TOKEN_TTL_SEC
            logger.info("Refreshed Lakebase OAuth token")
        return self._token  # type: ignore[return-value]

    @contextmanager
    def connect(self) -> Generator[psycopg.Connection, None, None]:
        host = self.config.lakebase_host
        if not host:
            raise RuntimeError("Lakebase host not configured (INTELLIGENT_DARTS_LAKEBASE_HOST)")

        # Resolve to IP to work around macOS DNS issues with psycopg
        try:
            ip = socket.gethostbyname(host)
        except OSError:
            ip = host

        token = self._fresh_token()
        user = self._get_user()

        conn_str = (
            f"host={host} hostaddr={ip} "
            f"dbname={_DB_NAME} "
            f"user={user} "
            f"password={token} "
            f"sslmode=require"
        )
        with psycopg.connect(conn_str) as conn:
            yield conn
