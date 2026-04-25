"""The primary entry point: :class:`RenderSDK`.

One method — :meth:`RenderSDK.deploy` — takes a local folder path and
returns a live onrender.com URL. It wires together validator, docker
builder, render api and service registry.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Callable, Optional

from dotenv import load_dotenv

from .docker_builder import DockerBuilder
from .exceptions import MissingDockerfileError
from .log_drain import LocalLogDrain
from .models import DeployResult, RegistryEntry
from .registry import ServiceRegistry
from .render_api import RenderAPIClient
from .utils import make_image_tag, make_slug, normalise_path, now_iso
from .validator import generate_fallback_dockerfile, validate_project

load_dotenv()

_DOCKER_HUB_PREFIX = "registry-1.docker.io"


class RenderSDK:
    """The single public class for the Render Deploy SDK.

    One call: ``sdk.deploy(local_path)`` → :class:`DeployResult` with live URL.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        docker_org: Optional[str] = None,
        docker_user: Optional[str] = None,
        docker_token: Optional[str] = None,
        registry_path: str = "~/.render_sdk/registry.json",
        default_region: str = "fra",
        default_plan: str = "free",
        poll_interval: int = 10,
        poll_timeout: int = 600,
        log_level: str = "INFO",
    ):
        # Constructor params take precedence over env vars.
        self.api_key      = api_key      or os.environ["RENDER_API_KEY"]
        self.docker_org   = docker_org   or os.environ["DOCKER_ORG"]
        self.docker_user  = docker_user  or os.getenv("DOCKER_USER")
        self.docker_token = docker_token or os.getenv("DOCKER_TOKEN")
        self.default_region = default_region
        self.default_plan   = default_plan
        self.poll_interval  = poll_interval
        self.poll_timeout   = poll_timeout

        # Sub-modules.
        self.registry = ServiceRegistry(registry_path)
        self.render   = RenderAPIClient(self.api_key)
        # Pass docker creds explicitly so push() works on hosts where the
        # daemon's credsStore (e.g. Docker Desktop on Windows) is opaque to
        # docker-py.
        self.docker   = DockerBuilder(
            docker_user=self.docker_user,
            docker_token=self.docker_token,
        )

        # Logging — configure once; if a higher layer already configured
        # the root logger (e.g. microbots.log), our basicConfig call is a
        # no-op.
        logging.basicConfig(
            format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
            datefmt="%H:%M:%S",
        )
        logging.getLogger("render_sdk").setLevel(
            getattr(logging, log_level.upper(), logging.INFO)
        )

    # ── Primary public method ───────────────────────────────────────────────

    def deploy(
        self,
        local_path: str,
        env_vars: Optional[dict] = None,
        region: Optional[str] = None,
        auto_generate_dockerfile: bool = False,
        stream_runtime_logs: bool = False,
        log_callback: Optional[Callable[[str], None]] = None,
    ) -> DeployResult:
        """Deploy a local folder to Render and return a live URL.

        This is the only method the platform backend needs to call.

        Args:
          local_path: Absolute or relative path to the project folder.
          env_vars: Env vars to inject into the service.
          region: Render region code. Defaults to ``self.default_region``.
          auto_generate_dockerfile: If ``True`` and no Dockerfile is found,
            generate one automatically (Python / Node auto-detection).
          stream_runtime_logs: If ``True``, open an ngrok-backed log drain
            after the deploy goes live. The caller owns the drain and
            must call ``drain.stop()`` when done.
          log_callback: Callable for log lines; defaults to ``logger.info``.

        Returns:
          A :class:`DeployResult` populated with url, service_id, deploy_id,
          duration, is_new, etc.
        """
        t_start = time.monotonic()
        emit = log_callback or (lambda msg: logging.getLogger("render_sdk").info(msg))
        region = region or self.default_region

        norm_path = normalise_path(local_path)
        emit(f"Deploying path: {norm_path}")

        self._validate(norm_path, auto_generate_dockerfile, emit)
        entry = self.registry.lookup(norm_path)
        is_new = entry is None

        slug, deploy_count = self._resolve_slug_and_count(norm_path, entry, emit)
        image_tag = make_image_tag(self.docker_org, slug, deploy_count)

        self.docker.build(norm_path, image_tag, log_callback=emit)
        self.docker.push(image_tag, log_callback=emit)

        service_id, live_url, deploy_id = self._render_action(
            norm_path=norm_path,
            entry=entry,
            slug=slug,
            image_tag=image_tag,
            region=region,
            env_vars=env_vars,
        )

        self.render.poll_until_live(
            service_id=service_id,
            deploy_id=deploy_id,
            poll_interval=self.poll_interval,
            timeout_s=self.poll_timeout,
            log_callback=emit,
        )

        self.registry.update(
            norm_path,
            status="live",
            last_deployed=now_iso(),
            deploy_count=deploy_count,
        )

        duration = round(time.monotonic() - t_start, 1)
        emit(f"Deploy complete in {duration}s -> {live_url}")

        if stream_runtime_logs:
            drain = LocalLogDrain(callback=emit)
            public_url = drain.start()
            emit(f"[log_drain] Runtime logs available at {public_url}")

        return DeployResult(
            url=live_url,
            service_id=service_id,
            deploy_id=deploy_id,
            service_name=slug,
            image_tag=image_tag,
            duration_s=duration,
            is_new=is_new,
            region=region,
        )

    # ── Private step methods ────────────────────────────────────────────────

    def _validate(
        self,
        norm_path: str,
        auto_generate_dockerfile: bool,
        emit: Callable[[str], None],
    ) -> dict:
        """Validate the project; optionally generate a fallback Dockerfile."""
        try:
            validation = validate_project(norm_path)
        except MissingDockerfileError:
            if not auto_generate_dockerfile:
                raise
            emit("No Dockerfile found — generating fallback...")
            generate_fallback_dockerfile(norm_path)
            validation = validate_project(norm_path)

        for warning in validation.get("warnings", []):
            emit(f"[warn] {warning}")
        return validation

    def _resolve_slug_and_count(
        self,
        norm_path: str,
        entry: RegistryEntry | None,
        emit: Callable[[str], None],
    ) -> tuple[str, int]:
        if entry is None:
            slug = make_slug(norm_path)
            emit(f"First deploy — new service will be named '{slug}'")
            return slug, 1
        emit(f"Existing service found: '{entry.service_name}' (id={entry.service_id})")
        return entry.service_name, entry.deploy_count + 1

    def _render_action(
        self,
        norm_path: str,
        entry: RegistryEntry | None,
        slug: str,
        image_tag: str,
        region: str,
        env_vars: Optional[dict],
    ) -> tuple[str, str, str]:
        """Create a new Render service or redeploy an existing one.

        Returns ``(service_id, live_url, deploy_id)``.
        """
        image_url = f"{_DOCKER_HUB_PREFIX}/{image_tag}"

        if entry is None:
            resp = self.render.create_service(
                service_name=slug,
                image_url=image_url,
                region=region,
                plan=self.default_plan,
                env_vars=env_vars,
                docker_user=self.docker_user,
                docker_token=self.docker_token,
            )
            service_id  = resp["service"]["id"]
            live_url    = resp["service"]["serviceDetails"]["url"]
            deploy_id   = resp.get("deployId", "unknown")
            deploy_hook = self.render.get_deploy_hook(service_id)

            new_entry = RegistryEntry(
                service_id=service_id,
                service_name=slug,
                deploy_hook=deploy_hook,
                image_repo=f"{self.docker_org}/{slug}",
                region=region,
                live_url=live_url,
                created_at=now_iso(),
                last_deployed=now_iso(),
                deploy_count=1,
                status="deploying",
            )
            self.registry.register(norm_path, new_entry)
            return service_id, live_url, deploy_id

        # Existing service.
        if env_vars:
            self.render.update_env_vars(entry.service_id, env_vars)

        if entry.deploy_hook:
            # Fast path — fire the deploy hook URL.
            deploy_id = self.render.trigger_deploy_hook(
                deploy_hook_url=entry.deploy_hook,
                image_url=image_url,
            )
        else:
            # Fallback — authenticated API call. Used when the deploy hook
            # was never surfaced (Render sometimes omits deployKey for
            # newly-created or free-tier services).
            deploy_id = self.render.trigger_redeploy(
                service_id=entry.service_id,
                image_url=image_url,
            )
        return entry.service_id, entry.live_url, deploy_id

    # ── Helper methods ──────────────────────────────────────────────────────

    def status(self, local_path: str) -> Optional[dict]:
        """Return registry info for a path, or ``None`` if not deployed."""
        entry = self.registry.lookup(normalise_path(local_path))
        if entry is None:
            return None
        return {
            "url":           entry.live_url,
            "service_id":    entry.service_id,
            "service_name":  entry.service_name,
            "status":        entry.status,
            "last_deployed": entry.last_deployed,
            "deploy_count":  entry.deploy_count,
            "region":        entry.region,
        }

    def list_services(self) -> list[dict]:
        """Return a list of all deployed services from the registry."""
        return [
            {"path": path, **entry.to_dict()}
            for path, entry in self.registry.list_all().items()
        ]

    def stream_logs(self, service_id: str, tail: int = 50) -> None:
        """Print the last ``tail`` deploy events for a service to stdout.

        This is the *status* log stream, not application runtime logs —
        see :class:`LocalLogDrain` for runtime streaming.
        """
        import requests

        resp = requests.get(
            f"https://api.render.com/v1/services/{service_id}/deploys",
            params={"limit": tail},
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        resp.raise_for_status()
        for item in resp.json():
            d = item.get("deploy", {})
            print(f"[{d.get('updatedAt', '?')}] {d.get('id', '?')} -> "
                  f"{d.get('status', 'unknown').upper()}")

    def teardown(self, local_path: str, delete_image: bool = False) -> None:
        """Delete the Render service and remove the registry entry."""
        norm_path = normalise_path(local_path)
        entry = self.registry.lookup(norm_path)
        if entry is None:
            logging.getLogger("render_sdk").warning(
                "[teardown] No registry entry for '%s'. Nothing to do.", norm_path
            )
            return

        self.render.delete_service(entry.service_id)

        if delete_image:
            logging.getLogger("render_sdk").info(
                "[teardown] Skipping image deletion from registry "
                "(requires Docker Hub API credentials). Remove manually: %s",
                entry.image_repo,
            )

        self.registry.remove(norm_path)
        logging.getLogger("render_sdk").info(
            "[teardown] Service '%s' deleted and registry entry removed.",
            entry.service_name,
        )
