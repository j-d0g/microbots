"""Dockerfile validation and fallback generation."""

from __future__ import annotations

import logging
import re
from pathlib import Path

from .exceptions import MissingDockerfileError, PortMissingError, SecretsLeakError

logger = logging.getLogger("render_sdk")

# Patterns that indicate secrets are being copied into the image.
SECRET_FILE_PATTERNS = re.compile(
    r"^\s*(COPY|ADD)\s+.*?(\.env|\.env\.\w+|secrets\.ya?ml|credentials\.json)",
    re.IGNORECASE | re.MULTILINE,
)

# First EXPOSE port wins; supports optional /tcp|/udp suffix.
_EXPOSE_PATTERN = re.compile(
    r"^\s*EXPOSE\s+(\d+)(?:/(?:tcp|udp))?", re.MULTILINE | re.IGNORECASE
)
_ENV_PORT_PATTERN = re.compile(
    r"^\s*ENV\s+PORT", re.MULTILINE | re.IGNORECASE
)


def validate_project(path: str) -> dict:
    """Validate the project folder before building.

    Checks:
      1. Dockerfile exists.
      2. ``EXPOSE`` directive is present.
      3. No secret files are being ``COPY``ed into the image.

    Returns a dict with:
      - ``exposed_port`` (int): first port found in ``EXPOSE``.
      - ``has_env_port`` (bool): whether ``ENV PORT`` is set.
      - ``warnings`` (list[str]): non-fatal issues.

    Raises:
      :class:`MissingDockerfileError`, :class:`PortMissingError`, :class:`SecretsLeakError`
    """
    project_path = Path(path)
    dockerfile_path = project_path / "Dockerfile"

    if not dockerfile_path.exists():
        raise MissingDockerfileError(str(path))

    content = dockerfile_path.read_text(encoding="utf-8")
    warnings: list[str] = []

    expose_matches = _EXPOSE_PATTERN.findall(content)
    if not expose_matches:
        raise PortMissingError(str(path))
    exposed_port = int(expose_matches[0])

    secret_match = SECRET_FILE_PATTERNS.search(content)
    if secret_match:
        raise SecretsLeakError(str(path), secret_match.group(0).strip())

    has_env_port = bool(_ENV_PORT_PATTERN.search(content))
    if not has_env_port:
        warnings.append(
            "Dockerfile does not set ENV PORT. "
            "SDK will inject ENV PORT=8080 at build time."
        )

    logger.debug(
        "[validator] OK — exposed_port=%d, has_env_port=%s, warnings=%s",
        exposed_port, has_env_port, warnings,
    )
    return {
        "exposed_port": exposed_port,
        "has_env_port": has_env_port,
        "warnings": warnings,
    }


def generate_fallback_dockerfile(path: str) -> str:
    """Generate a minimal Dockerfile for the project if none exists.

    Detects Python (``requirements.txt``) or Node (``package.json``).
    Writes the Dockerfile to the project path and returns its contents.

    Raises :class:`MissingDockerfileError` (with a clarifying ``reason``)
    if the runtime cannot be auto-detected.
    """
    project_path = Path(path)

    if (project_path / "requirements.txt").exists():
        content = (
            "FROM python:3.11-slim\n"
            "WORKDIR /app\n"
            "COPY requirements.txt .\n"
            "RUN pip install --no-cache-dir -r requirements.txt\n"
            "COPY . .\n"
            "ENV PORT=8080\n"
            "EXPOSE 8080\n"
            'CMD ["python", "main.py"]\n'
        )
        runtime = "Python"
    elif (project_path / "package.json").exists():
        content = (
            "FROM node:20-slim\n"
            "WORKDIR /app\n"
            "COPY package*.json .\n"
            "RUN npm ci --only=production\n"
            "COPY . .\n"
            "ENV PORT=8080\n"
            "EXPOSE 8080\n"
            'CMD ["node", "index.js"]\n'
        )
        runtime = "Node.js"
    else:
        raise MissingDockerfileError(
            str(path),
            reason=(
                f"{path} — could not auto-detect runtime "
                "(no requirements.txt or package.json found)."
            ),
        )

    dockerfile_path = project_path / "Dockerfile"
    dockerfile_path.write_text(content, encoding="utf-8")
    logger.info(
        "[validator] Generated %s Dockerfile at %s", runtime, dockerfile_path
    )
    return content
