"""Thin wrapper around docker-py for build + push with retry and log capture."""

from __future__ import annotations

import logging
from collections import deque
from typing import Callable, Optional

import docker
from docker.errors import APIError, BuildError

from .exceptions import DockerBuildError, RegistryPushError
from .utils import retry

logger = logging.getLogger("render_sdk")

# Keep at most this many build log lines in memory (avoid OOM on pathological builds).
_MAX_BUILD_LOG_LINES = 2000


class DockerBuilder:
    """Build and push Docker images.

    If ``docker_user`` / ``docker_token`` are provided they are passed
    explicitly to every push as ``auth_config``. This is required on
    Windows + Docker Desktop where ``docker-py`` cannot read the
    ``credsStore: "desktop"`` helper and would otherwise hit 401.

    Without those args we fall back to whatever is in
    ``~/.docker/config.json`` (i.e. the host machine must already be
    logged in via ``docker login``).
    """

    def __init__(
        self,
        docker_user: Optional[str] = None,
        docker_token: Optional[str] = None,
    ):
        self.client = docker.from_env()
        self._auth_config: Optional[dict] = None
        if docker_user and docker_token:
            self._auth_config = {"username": docker_user, "password": docker_token}

    def build(
        self,
        path: str,
        image_tag: str,
        log_callback: Optional[Callable[[str], None]] = None,
    ) -> str:
        """Build a Docker image from the given path.

        Also applies a ``:latest`` tag alongside the explicit ``image_tag``.

        Args:
          path: Absolute path to the project folder (contains a Dockerfile).
          image_tag: Full image reference e.g. ``"myorg/lead-scraper-a1b2:7"``.
          log_callback: Optional callable that receives each log line.

        Returns the ``image_tag`` on success; raises :class:`DockerBuildError`
        on failure.
        """
        logger.info("[docker] Building image '%s' from path '%s'", image_tag, path)
        recent_logs: deque[str] = deque(maxlen=_MAX_BUILD_LOG_LINES)

        try:
            _, logs = self.client.images.build(
                path=path,
                tag=image_tag,
                rm=True,            # Remove intermediate containers.
                forcerm=True,
                nocache=False,
            )
            for chunk in logs:
                line = (chunk.get("stream") or chunk.get("status") or "").rstrip()
                if not line:
                    continue
                recent_logs.append(line)
                if log_callback:
                    log_callback(line)
                else:
                    logger.debug("[docker build] %s", line)
        except BuildError as e:
            # BuildError carries its own build log sequence.
            for chunk in getattr(e, "build_log", []) or []:
                line = (chunk.get("stream") or chunk.get("message") or "").rstrip()
                if line:
                    recent_logs.append(line)
            raise DockerBuildError(image_tag, "\n".join(recent_logs)) from e

        # Apply the :latest alias so deploys can reference either tag.
        latest_tag = image_tag.rsplit(":", 1)[0] + ":latest"
        self.client.images.get(image_tag).tag(latest_tag)

        logger.info("[docker] Build complete -> %s (also tagged :latest)", image_tag)
        return image_tag

    @retry(times=3, delay=5.0, exceptions=(RegistryPushError,))
    def push(
        self,
        image_tag: str,
        log_callback: Optional[Callable[[str], None]] = None,
    ) -> str:
        """Push the image (and its ``:latest`` alias) to the registry.

        Returns the ``image_tag`` on success. Raises
        :class:`RegistryPushError` after 3 failed attempts (via :func:`retry`).
        """
        logger.info("[docker] Pushing '%s' to registry...", image_tag)
        base = image_tag.rsplit(":", 1)[0]

        for tag in (image_tag, f"{base}:latest"):
            try:
                response = self.client.images.push(
                    tag,
                    stream=True,
                    decode=True,
                    auth_config=self._auth_config,
                )
                for chunk in response:
                    if "error" in chunk:
                        raise RegistryPushError(tag, chunk["error"])
                    status_line = chunk.get("status", "")
                    if status_line and log_callback:
                        log_callback(f"[push] {status_line}")
                logger.info("[docker] Pushed %s", tag)
            except APIError as e:
                raise RegistryPushError(tag, str(e)) from e

        return image_tag
