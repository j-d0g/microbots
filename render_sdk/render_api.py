"""Thin client for the Render REST API.

Handles service creation, deploy hooks, status polling, env-var updates
and service deletion. Uses a single :class:`requests.Session` so auth
headers are attached uniformly and connections are pooled.
"""

from __future__ import annotations

import logging
import time
import urllib.parse
from typing import Callable, Optional

import requests

from .exceptions import DeployError, DeployTimeoutError, ServiceCreateError

logger = logging.getLogger("render_sdk")

RENDER_BASE = "https://api.render.com/v1"

# All terminal deploy statuses the poller respects.
TERMINAL_STATUSES = frozenset({"live", "build_failed", "canceled", "deactivated"})
SUCCESS_STATUS = "live"

# Map short region codes (used in env vars / SDK args) to the full region
# names the Render v1 API expects in `serviceDetails.region`.
REGION_ALIASES = {
    "fra":       "frankfurt",
    "ore":       "oregon",
    "oh":        "ohio",
    "ohio":      "ohio",
    "sgp":       "singapore",
    "vir":       "virginia",
    "frankfurt": "frankfurt",
    "oregon":    "oregon",
    "singapore": "singapore",
    "virginia":  "virginia",
}


def _normalise_region(region: str) -> str:
    return REGION_ALIASES.get(region.lower(), region.lower())


class RenderAPIClient:
    """Handles service creation, deploy hooks, and status polling."""

    def __init__(self, api_key: str):
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {api_key}",
            "Content-Type":  "application/json",
            "Accept":        "application/json",
        })
        self._owner_id: Optional[str] = None

    # ── Owner ID lookup (cached) ────────────────────────────────────────────

    def _get_owner_id(self) -> str:
        """Return the first owner id for the API key, cached after first call.

        Render's create-service endpoint requires both a top-level ``ownerId``
        and an ``image.ownerId``. Most accounts have a single owner — we just
        pick the first one returned.
        """
        if self._owner_id:
            return self._owner_id

        resp = self._session.get(f"{RENDER_BASE}/owners")
        resp.raise_for_status()
        owners = resp.json()
        if not owners:
            raise ServiceCreateError(200, "No owners found for this Render API key.")
        self._owner_id = owners[0]["owner"]["id"]
        logger.debug("[render] Resolved ownerId=%s", self._owner_id)
        return self._owner_id

    # ── Service creation ────────────────────────────────────────────────────

    def create_service(
        self,
        service_name: str,
        image_url: str,
        region: str,
        plan: str,
        env_vars: Optional[dict] = None,
        docker_user: Optional[str] = None,
        docker_token: Optional[str] = None,
    ) -> dict:
        """Create a new Render web service backed by a Docker image.

        Returns the full API response dict (including ``service.id``,
        ``service.serviceDetails.url`` and the initial ``deployId``).
        Raises :class:`ServiceCreateError` on 4xx/5xx.
        """
        owner_id = self._get_owner_id()
        normalised_region = _normalise_region(region)

        payload: dict = {
            "type":    "web_service",
            "name":    service_name,
            "ownerId": owner_id,
            "image": {
                "ownerId":   owner_id,
                "imagePath": image_url,
            },
            "serviceDetails": {
                "runtime":         "image",
                "plan":            plan,
                "region":          normalised_region,
                "healthCheckPath": "/health",
                "numInstances":    1,
            },
        }

        # Private Docker Hub repos require pre-registered registry credentials
        # (POST /v1/registry-credentials → reference by id). The current SDK
        # only supports public images; if creds were passed we log a warning
        # and continue. TODO: register them on the fly.
        if docker_user and docker_token:
            logger.warning(
                "[render] Docker creds were supplied but the v1 API requires "
                "pre-registered registry credentials. Assuming the image is "
                "public — pulls will fail otherwise."
            )

        if env_vars:
            payload["envVars"] = [
                {"key": k, "value": str(v)} for k, v in env_vars.items()
            ]

        logger.info(
            "[render] Creating service '%s' in region '%s' (plan=%s)...",
            service_name, normalised_region, plan,
        )
        resp = self._session.post(f"{RENDER_BASE}/services", json=payload)

        if not resp.ok:
            raise ServiceCreateError(resp.status_code, resp.text)

        data = resp.json()
        logger.info(
            "[render] Service created -> id=%s, url=%s",
            data["service"]["id"],
            data["service"]["serviceDetails"]["url"],
        )
        return data

    def get_deploy_hook(self, service_id: str) -> str:
        """Retrieve the deploy hook URL for an existing service.

        Render exposes the hook key inside ``GET /services/{id}``. Returns
        the full usable URL, or an empty string if the key isn't present
        (the user hasn't enabled deploy hooks for the service).
        """
        resp = self._session.get(f"{RENDER_BASE}/services/{service_id}")
        resp.raise_for_status()
        data = resp.json()

        hook_key = data.get("service", {}).get("deployKey", "")
        if not hook_key:
            logger.warning(
                "[render] No deploy hook key found for %s. "
                "Enable it in the Render dashboard.",
                service_id,
            )
            return ""
        return f"https://api.render.com/deploy/{service_id}?key={hook_key}"

    # ── Redeploy via hook ───────────────────────────────────────────────────

    def trigger_deploy_hook(self, deploy_hook_url: str, image_url: str) -> str:
        """Trigger a redeploy of an existing service using its deploy hook.

        This is the fast path — no service re-creation. Returns the
        ``deploy_id`` string from the response.
        """
        encoded_image = urllib.parse.quote(image_url, safe="")
        url = f"{deploy_hook_url}&imgURL={encoded_image}"

        logger.info("[render] Triggering deploy hook for image '%s'...", image_url)
        resp = self._session.post(url)
        resp.raise_for_status()

        data = resp.json()
        deploy_id = data.get("id") or data.get("deploy", {}).get("id") or "unknown"
        logger.info("[render] Deploy triggered -> deploy_id=%s", deploy_id)
        return deploy_id

    def trigger_redeploy(self, service_id: str, image_url: str) -> str:
        """Redeploy an existing service via the authenticated v1 API.

        This is the fallback path used when a service has no deploy hook
        key (e.g. on services where Render hasn't surfaced ``deployKey``).
        Calls ``POST /v1/services/{id}/deploys`` with the new image URL.

        Render requires the host/repo/image name to match the service's
        existing configuration — only the tag may change.
        """
        logger.info(
            "[render] Triggering API redeploy for service '%s' (image=%s)...",
            service_id, image_url,
        )
        resp = self._session.post(
            f"{RENDER_BASE}/services/{service_id}/deploys",
            json={"imageUrl": image_url, "clearCache": "do_not_clear"},
        )
        if not resp.ok:
            raise DeployError(service_id, f"create_deploy_{resp.status_code}", resp.text)

        data = resp.json()
        deploy_id = data.get("id") or data.get("deploy", {}).get("id") or "unknown"
        logger.info("[render] API redeploy queued -> deploy_id=%s", deploy_id)
        return deploy_id

    # ── Status polling ──────────────────────────────────────────────────────

    def poll_until_live(
        self,
        service_id: str,
        deploy_id: str,
        poll_interval: int = 10,
        timeout_s: int = 600,
        log_callback: Optional[Callable[[str], None]] = None,
    ) -> str:
        """Poll the deploys API until the deploy reaches a terminal status.

        Returns ``"live"`` on success; raises :class:`DeployError` on
        build_failed / canceled; raises :class:`DeployTimeoutError` if
        ``timeout_s`` is exceeded.
        """
        start = time.monotonic()
        seen_status: str | None = None
        emit = log_callback or (lambda msg: logger.info(msg))

        emit(f"[render] Polling deploy {deploy_id} for service {service_id}...")

        while True:
            elapsed = int(time.monotonic() - start)
            if elapsed > timeout_s:
                raise DeployTimeoutError(service_id, timeout_s)

            resp = self._session.get(
                f"{RENDER_BASE}/services/{service_id}/deploys",
                params={"limit": 5},
            )
            resp.raise_for_status()
            deploys = resp.json()

            current = self._pick_deploy(deploys, deploy_id)
            if current is None:
                emit(f"[{elapsed:>4}s] Waiting for deploy to appear...")
                time.sleep(poll_interval)
                continue

            status = current.get("status", "unknown")

            if status != seen_status:
                emit(f"[{elapsed:>4}s] Deploy status -> {status.upper()}")
                seen_status = status

            if status in TERMINAL_STATUSES:
                if status != SUCCESS_STATUS:
                    raise DeployError(service_id, status)
                return status

            time.sleep(poll_interval)

    @staticmethod
    def _pick_deploy(deploys: list[dict], deploy_id: str) -> dict | None:
        """Find the deploy matching ``deploy_id``, falling back to the most
        recent one if Render hasn't surfaced the specific id yet."""
        if not deploys:
            return None
        for item in deploys:
            d = item.get("deploy", {})
            if d.get("id") == deploy_id:
                return d
        return deploys[0].get("deploy")

    # ── Env vars update ─────────────────────────────────────────────────────

    def update_env_vars(self, service_id: str, env_vars: dict) -> None:
        """Patch env vars on an existing service."""
        payload = [{"key": k, "value": str(v)} for k, v in env_vars.items()]
        resp = self._session.put(
            f"{RENDER_BASE}/services/{service_id}/env-vars", json=payload,
        )
        resp.raise_for_status()
        logger.info(
            "[render] Updated %d env vars for service %s", len(env_vars), service_id
        )

    # ── Service deletion ────────────────────────────────────────────────────

    def delete_service(self, service_id: str) -> None:
        """Permanently delete a Render service."""
        resp = self._session.delete(f"{RENDER_BASE}/services/{service_id}")
        resp.raise_for_status()
        logger.info("[render] Deleted Render service %s", service_id)
