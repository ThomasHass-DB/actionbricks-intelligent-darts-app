"""Kinesis Video Streams WebRTC — obtain viewer connection config.

The backend calls AWS KVS APIs to:
1. Resolve the signaling channel ARN from its name.
2. Get the WSS and HTTPS endpoints for the channel.
3. Get ICE server config (TURN/STUN) for NAT traversal.
4. Return everything the browser needs to open a WebRTC viewer peer connection.

Credential resolution order:
  - If a Databricks UC *service credential name* is configured, we try to
    build a boto3 session through the Databricks SDK credential provider.
  - Otherwise we fall back to the default boto3 credential chain (env vars,
    instance metadata, ~/.aws, etc.).
"""

from __future__ import annotations

import hashlib
import hmac
import urllib.parse
from datetime import datetime, timezone
from typing import Any

import boto3
from pydantic import BaseModel, Field

from .logger import logger


# ── Response models ──────────────────────────────────────────────────────────

class IceServer(BaseModel):
    urls: list[str]
    username: str = ""
    credential: str = ""


class ViewerConnectionInfo(BaseModel):
    """Everything the browser needs to connect as a WebRTC viewer."""
    channel_arn: str = Field(description="Signaling channel ARN")
    wss_endpoint: str = Field(description="Raw WSS endpoint (unsigned)")
    signed_wss_url: str = Field(default="", description="SigV4 pre-signed WSS URL for browser")
    ice_servers: list[IceServer] = Field(default_factory=list)
    region: str = ""


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_boto3_session(
    service_credential_name: str | None,
    region: str,
) -> boto3.Session:
    """Build a boto3 session, optionally backed by a Databricks service credential.

    Uses the UC Credentials API (`generate_temporary_service_credential`) to
    obtain short-lived AWS STS credentials (access key, secret key, session
    token) from the named service credential.  Falls back to the default boto3
    credential chain when the service credential is not configured or the API
    call fails.
    """
    if service_credential_name:
        try:
            from databricks.sdk import WorkspaceClient  # noqa: F811

            ws = WorkspaceClient()

            logger.info(
                f"Generating temporary AWS credentials from service credential "
                f"'{service_credential_name}' …"
            )
            temp_creds = ws.credentials.generate_temporary_service_credential(
                credential_name=service_credential_name,
            )

            # The response contains an `aws_temp_credentials` object with
            # access_key_id, secret_access_key, and session_token.
            aws_creds = temp_creds.aws_temp_credentials
            if aws_creds and aws_creds.access_key_id:
                logger.info(
                    f"Got temporary AWS credentials (key=…{aws_creds.access_key_id[-4:]})"
                )
                return boto3.Session(
                    aws_access_key_id=aws_creds.access_key_id,
                    aws_secret_access_key=aws_creds.secret_access_key,
                    aws_session_token=aws_creds.session_token,
                    region_name=region,
                )
            else:
                logger.warning(
                    "generate_temporary_service_credential returned no AWS credentials. "
                    "Falling back to default boto3 credential chain."
                )

        except Exception as exc:
            logger.warning(
                f"Could not generate temp credentials from service credential "
                f"'{service_credential_name}': {exc}. "
                "Falling back to default AWS credentials."
            )

    return boto3.Session(region_name=region)


def _get_channel_arn(
    kvs_client: Any,
    channel_name: str,
) -> str:
    """Resolve a signaling channel name → ARN."""
    resp = kvs_client.describe_signaling_channel(ChannelName=channel_name)
    return resp["ChannelInfo"]["ChannelARN"]


def _get_endpoints(
    kvs_client: Any,
    channel_arn: str,
) -> dict[str, str]:
    """Get WSS + HTTPS endpoints for a signaling channel."""
    resp = kvs_client.get_signaling_channel_endpoint(
        ChannelARN=channel_arn,
        SingleMasterChannelEndpointConfiguration={
            "Protocols": ["WSS", "HTTPS"],
            "Role": "VIEWER",
        },
    )
    endpoints: dict[str, str] = {}
    for ep in resp["ResourceEndpointList"]:
        endpoints[ep["Protocol"]] = ep["ResourceEndpoint"]
    return endpoints


def _sign_wss_url(
    wss_endpoint: str,
    channel_arn: str,
    region: str,
    session: boto3.Session,
    client_id: str = "viewer-browser",
) -> str:
    """Create a SigV4 pre-signed WSS URL for the KVS signaling channel.

    KVS requires the WebSocket URL to be signed with AWS SigV4.  This is
    similar to S3 pre-signed URLs but uses the ``kinesisvideo`` service.
    """
    credentials = session.get_credentials()
    if credentials is None:
        raise RuntimeError("No AWS credentials available to sign WSS URL")

    frozen = credentials.get_frozen_credentials()
    access_key = frozen.access_key
    secret_key = frozen.secret_key
    session_token = frozen.token  # may be None for long-lived keys

    # Parse the WSS endpoint
    parsed = urllib.parse.urlparse(wss_endpoint)
    host = parsed.hostname or ""
    # KVS signaling uses the root path — the AWS SDK reference implementation
    # (SigV4RequestSigner) uses "/" as the canonical URI.
    path = "/"

    now = datetime.now(timezone.utc)
    datestamp = now.strftime("%Y%m%d")
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    service = "kinesisvideo"
    credential_scope = f"{datestamp}/{region}/{service}/aws4_request"

    # Canonical query string (params must be sorted)
    query_params: dict[str, str] = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-ChannelARN": channel_arn,
        "X-Amz-ClientId": client_id,
        "X-Amz-Credential": f"{access_key}/{credential_scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": "300",
        "X-Amz-SignedHeaders": "host",
    }
    if session_token:
        query_params["X-Amz-Security-Token"] = session_token

    canonical_qs = "&".join(
        f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(v, safe='')}"
        for k, v in sorted(query_params.items())
    )

    # Canonical request
    canonical_headers = f"host:{host}\n"
    signed_headers = "host"
    payload_hash = hashlib.sha256(b"").hexdigest()

    canonical_request = "\n".join([
        "GET",
        path,
        canonical_qs,
        canonical_headers,
        signed_headers,
        payload_hash,
    ])

    # String to sign
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256",
        amz_date,
        credential_scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ])

    # Signing key
    def _sign(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

    k_date = _sign(f"AWS4{secret_key}".encode("utf-8"), datestamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, service)
    k_signing = _sign(k_service, "aws4_request")

    signature = hmac.new(
        k_signing, string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    # Build final URL
    signed_url = (
        f"wss://{host}{path}?{canonical_qs}"
        f"&X-Amz-Signature={signature}"
    )

    return signed_url


def _get_ice_servers(
    https_endpoint: str,
    channel_arn: str,
    region: str,
    session: boto3.Session,
) -> list[IceServer]:
    """Get TURN/STUN ICE server configuration."""
    kvs_signaling = session.client(
        "kinesis-video-signaling",
        endpoint_url=https_endpoint,
        region_name=region,
    )
    resp = kvs_signaling.get_ice_server_config(ChannelARN=channel_arn)
    servers: list[IceServer] = []

    # Always include the default STUN server
    servers.append(IceServer(urls=[f"stun:stun.kinesisvideo.{region}.amazonaws.com:443"]))

    for cfg in resp.get("IceServerList", []):
        urls = cfg.get("Uris", [])
        servers.append(
            IceServer(
                urls=urls,
                username=cfg.get("Username", ""),
                credential=cfg.get("Password", ""),
            )
        )
    return servers


# ── Public API ───────────────────────────────────────────────────────────────

def get_viewer_connection_info(
    channel_name: str,
    region: str,
    service_credential_name: str | None = None,
) -> ViewerConnectionInfo:
    """Return the full viewer connection config for a single signaling channel."""
    session = _get_boto3_session(service_credential_name, region)
    kvs = session.client("kinesisvideo", region_name=region)

    # 1. Resolve channel ARN
    channel_arn = _get_channel_arn(kvs, channel_name)
    logger.info(f"Resolved channel '{channel_name}' → {channel_arn}")

    # 2. Get endpoints
    endpoints = _get_endpoints(kvs, channel_arn)
    wss_endpoint = endpoints.get("WSS", "")
    https_endpoint = endpoints.get("HTTPS", "")
    logger.info(f"Endpoints — WSS: {wss_endpoint}, HTTPS: {https_endpoint}")

    # 3. Get ICE servers
    ice_servers = _get_ice_servers(https_endpoint, channel_arn, region, session)

    # 4. Pre-sign the WSS URL so the browser can connect without AWS creds
    import uuid
    client_id = f"viewer-{uuid.uuid4().hex[:8]}"
    signed_wss_url = _sign_wss_url(wss_endpoint, channel_arn, region, session, client_id=client_id)
    logger.info(f"Signed WSS URL generated (clientId={client_id}, length={len(signed_wss_url)})")

    return ViewerConnectionInfo(
        channel_arn=channel_arn,
        wss_endpoint=wss_endpoint,
        signed_wss_url=signed_wss_url,
        ice_servers=ice_servers,
        region=region,
    )
