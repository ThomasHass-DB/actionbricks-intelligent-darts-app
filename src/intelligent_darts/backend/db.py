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
_MAX_RETRIES = 3
_RETRY_DELAY_SEC = 1.0


class DbManager:
    """Manages a Lakebase Postgres connection with automatic token/password refresh.

    Supports two authentication modes:
    1. Static password (preferred for Databricks Apps): when config.lakebase_password
       is set (injected via a Databricks Secret), it is used directly as the PostgreSQL
       password. This works reliably from Databricks Apps internal network.
    2. OAuth token: when no static password is configured, generates a short-lived
       Lakebase OAuth token via WorkspaceClient. Suitable for local dev and environments
       where the Databricks Apps internal network OAuth auth isn't available.

    Uses keyword-argument connect() (not a connection string) so that JWT tokens or
    passwords containing '+', '/', '=' chars are never subject to string parsing.

    Retries up to _MAX_RETRIES times to recover from scale-to-zero wake-ups.

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
            me = self._ws.current_user.me()
            # For regular users user_name is their email.
            # For service principals user_name is None — fall back to
            # application_id (UUID) or the SDK config's client_id.
            self._user = (
                me.user_name
                or getattr(me, "application_id", None)
                or self._ws.config.client_id
            )
            if not self._user:
                raise RuntimeError("Cannot determine PostgreSQL username from Databricks identity")
            logger.info(f"Lakebase PostgreSQL user: {self._user}")
        return self._user  # type: ignore[return-value]

    def _fresh_token(self, force: bool = False) -> str:
        now = time.monotonic()
        if force or self._token is None or now >= self._token_expires_at:
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

        # Resolve hostname to IP only on macOS (needed to work around macOS DNS issues
        # with psycopg). On Linux (deployed app), use the hostname directly.
        import platform
        if platform.system() == "Darwin":
            try:
                ip = socket.gethostbyname(host)
            except OSError:
                ip = host
            extra_kwargs = {"hostaddr": ip}
        else:
            extra_kwargs = {}

        # Choose auth: static password (from Databricks Secret) or OAuth token.
        static_password = self.config.lakebase_password
        use_static = bool(static_password)

        last_exc: Exception | None = None
        for attempt in range(_MAX_RETRIES):
            if use_static:
                password = static_password
                user = self._get_user()
            else:
                # Force a fresh token on retry (previous token may have been the issue)
                password = self._fresh_token(force=(attempt > 0))
                user = self._get_user()

            try:
                # Use keyword arguments — never embed the password in a connection string,
                # as '+', '/', '=' chars break libpq string parsing.
                with psycopg.connect(
                    host=host,
                    dbname=_DB_NAME,
                    user=user,
                    password=password,
                    sslmode="require",
                    **extra_kwargs,
                ) as conn:
                    yield conn
                    return
            except psycopg.OperationalError as exc:
                last_exc = exc
                logger.warning(f"Lakebase connect attempt {attempt + 1}/{_MAX_RETRIES} failed: {exc}")
                if attempt < _MAX_RETRIES - 1:
                    time.sleep(_RETRY_DELAY_SEC * (attempt + 1))

        raise last_exc  # type: ignore[misc]
