# AGENT_BUILD.md
# Layer 3 — Render Deploy SDK: Complete Build Instructions

> **Agent Instructions:** Read this file top-to-bottom before writing a single line of code.
> Build every file in the exact order listed. Do not skip sections. Do not summarise —
> implement every function, class, and method fully. When a code block says "implement this",
> write the complete working code.

---

## 0. Pre-Flight Checklist

Before building, confirm the following are available in the environment:

- [ ] Python 3.11+
- [ ] Docker daemon running (`docker info` returns successfully)
- [ ] The following env vars are set (or will be injected at runtime):
  - `RENDER_API_KEY`
  - `DOCKER_ORG`
  - `DOCKER_USER`
  - `DOCKER_TOKEN`

---

## 1. Project Scaffold

Create this exact directory tree. Every file must exist before you start filling them.

```
render_sdk/
├── __init__.py
├── sdk.py
├── registry.py
├── docker_builder.py
├── render_api.py
├── log_drain.py
├── validator.py
├── models.py
├── exceptions.py
├── utils.py
├── cli.py
├── tests/
│   ├── __init__.py
│   ├── test_registry.py
│   ├── test_validator.py
│   ├── test_docker_builder.py
│   ├── test_render_api.py
│   └── test_sdk_integration.py
├── pyproject.toml
└── README.md
```

**Command to scaffold:**

```bash
mkdir -p render_sdk/tests
touch render_sdk/__init__.py render_sdk/sdk.py render_sdk/registry.py \
      render_sdk/docker_builder.py render_sdk/render_api.py \
      render_sdk/log_drain.py render_sdk/validator.py render_sdk/models.py \
      render_sdk/exceptions.py render_sdk/utils.py render_sdk/cli.py \
      render_sdk/tests/__init__.py render_sdk/tests/test_registry.py \
      render_sdk/tests/test_validator.py render_sdk/tests/test_docker_builder.py \
      render_sdk/tests/test_render_api.py render_sdk/tests/test_sdk_integration.py \
      render_sdk/pyproject.toml render_sdk/README.md
```

---

## 2. `pyproject.toml` — Dependencies

Write this file first so the agent can install deps before implementing.

```toml
[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.backends.legacy:build"

[project]
name = "render-sdk"
version = "1.0.0"
description = "Automated local-path to Render.com deployment SDK"
requires-python = ">=3.11"
dependencies = [
    "docker>=7.0",
    "requests>=2.31",
    "portalocker>=2.8",
    "python-dotenv>=1.0",
    "pyngrok>=7.0",
    "click>=8.1",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-mock>=3.12",
    "responses>=0.25",
    "pytest-cov>=5.0",
]

[project.scripts]
render-sdk = "render_sdk.cli:main"

[tool.pytest.ini_options]
testpaths = ["tests"]
```

**Install command the agent must run after writing this file:**

```bash
pip install docker requests portalocker python-dotenv pyngrok click
pip install pytest pytest-mock responses pytest-cov
```

---

## 3. `exceptions.py` — All Custom Errors

Build this second. Every other module imports from here.

```python
# render_sdk/exceptions.py


class RenderSDKError(Exception):
    """Base class for all SDK errors."""
    pass


class MissingDockerfileError(RenderSDKError):
    """Raised when no Dockerfile is found in the project path."""
    def __init__(self, path: str):
        super().__init__(
            f"No Dockerfile found in '{path}'. "
            f"The agent must generate a Dockerfile before calling deploy()."
        )
        self.path = path


class PortMissingError(RenderSDKError):
    """Raised when Dockerfile does not expose a port."""
    def __init__(self, path: str):
        super().__init__(
            f"Dockerfile in '{path}' has no EXPOSE directive. "
            f"Add 'EXPOSE 8080' (or your chosen port)."
        )
        self.path = path


class SecretsLeakError(RenderSDKError):
    """Raised when .env or secret files are being COPYed into the image."""
    def __init__(self, path: str, offending_line: str):
        super().__init__(
            f"Dockerfile in '{path}' copies a secrets file: '{offending_line}'. "
            f"Add .env to .dockerignore and use --env-file or env_vars dict instead."
        )
        self.path = path
        self.offending_line = offending_line


class DockerBuildError(RenderSDKError):
    """Raised when docker build fails."""
    def __init__(self, image_tag: str, log: str):
        super().__init__(
            f"Docker build failed for image '{image_tag}'.\n"
            f"Build output:\n{log}"
        )
        self.image_tag = image_tag
        self.build_log = log


class RegistryPushError(RenderSDKError):
    """Raised when docker push fails after all retries."""
    def __init__(self, image_tag: str, reason: str):
        super().__init__(
            f"Failed to push image '{image_tag}' after 3 retries. Reason: {reason}"
        )
        self.image_tag = image_tag


class ServiceCreateError(RenderSDKError):
    """Raised when the Render API rejects service creation."""
    def __init__(self, status_code: int, body: str):
        super().__init__(
            f"Render API returned {status_code} on service creation. Body: {body}"
        )
        self.status_code = status_code
        self.body = body


class DeployError(RenderSDKError):
    """Raised when a deploy ends in build_failed or canceled state."""
    def __init__(self, service_id: str, status: str, reason: str = ""):
        super().__init__(
            f"Deploy for service '{service_id}' ended with status '{status}'. {reason}"
        )
        self.service_id = service_id
        self.status = status


class DeployTimeoutError(RenderSDKError):
    """Raised when deploy polling exceeds the timeout."""
    def __init__(self, service_id: str, timeout_s: int):
        super().__init__(
            f"Deploy for service '{service_id}' did not go live within {timeout_s}s. "
            f"Check the Render dashboard for build logs."
        )
        self.service_id = service_id


class RegistryCorruptError(RenderSDKError):
    """Raised when the JSON registry file cannot be parsed."""
    def __init__(self, registry_path: str, reason: str):
        super().__init__(
            f"Registry file '{registry_path}' is corrupt: {reason}. "
            f"A backup has been saved with a .bak extension."
        )
        self.registry_path = registry_path


class ConcurrentDeployError(RenderSDKError):
    """Raised when the same path is already being deployed by another process."""
    def __init__(self, path: str):
        super().__init__(
            f"A deploy for path '{path}' is already in progress (file lock held). "
            f"Wait for it to complete before redeploying."
        )
        self.path = path
```

---

## 4. `models.py` — Data Classes

```python
# render_sdk/models.py

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class DeployResult:
    """Returned by sdk.deploy() on success."""
    url: str                    # Live onrender.com URL
    service_id: str             # Render service ID  (srv-…)
    deploy_id: str              # Render deploy ID   (dep-…)
    service_name: str           # Human-readable slug used on Render
    image_tag: str              # Full image URL pushed to registry
    duration_s: float           # Seconds from deploy() call to live status
    is_new: bool                # True if a new Render service was created
    region: str                 # Render region code (fra, ore, etc.)


@dataclass
class RegistryEntry:
    """One entry in the JSON service registry."""
    service_id: str
    service_name: str
    deploy_hook: str            # Full deploy hook URL (includes key param)
    image_repo: str             # e.g. "myorg/lead-scraper-a1b2"
    region: str
    live_url: str
    created_at: str             # ISO-8601
    last_deployed: str          # ISO-8601
    deploy_count: int
    status: str                 # live | build_failed | deploying | unknown

    def to_dict(self) -> dict:
        return {
            "service_id":    self.service_id,
            "service_name":  self.service_name,
            "deploy_hook":   self.deploy_hook,
            "image_repo":    self.image_repo,
            "region":        self.region,
            "live_url":      self.live_url,
            "created_at":    self.created_at,
            "last_deployed": self.last_deployed,
            "deploy_count":  self.deploy_count,
            "status":        self.status,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "RegistryEntry":
        return cls(**d)
```

---

## 5. `utils.py` — Helpers

```python
# render_sdk/utils.py

import hashlib
import re
import time
import logging
from pathlib import Path
from datetime import datetime, timezone
from functools import wraps

logger = logging.getLogger("render_sdk")


def normalise_path(path: str | Path) -> str:
    """
    Resolve symlinks, expand ~, strip trailing slash.
    Returns a normalised absolute path string.
    This is the canonical registry key.
    """
    return str(Path(path).expanduser().resolve())


def make_slug(path: str) -> str:
    """
    Derive a Render-safe service name from the path.

    Rules:
    - Use only the final directory name (basename)
    - Lowercase
    - Replace non-alphanumeric chars with hyphens
    - Collapse consecutive hyphens
    - Strip leading/trailing hyphens
    - Truncate to 30 chars
    - Append 4-char SHA-256 hash of the full path for collision resistance
    - Result: "{slug}-{hash4}"  e.g. "lead-scraper-a1b2"
    """
    folder_name = Path(path).name
    slug = folder_name.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    slug = slug[:30].rstrip("-")

    path_hash = hashlib.sha256(path.encode()).hexdigest()[:4]
    return f"{slug}-{path_hash}"


def make_image_tag(docker_org: str, slug: str, deploy_count: int) -> str:
    """
    Build the full Docker image reference.
    Format: {docker_org}/{slug}:{deploy_count}
    Also tagged :latest separately by docker_builder.
    """
    return f"{docker_org}/{slug}:{deploy_count}"


def now_iso() -> str:
    """Return current UTC time as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def retry(times: int = 3, delay: float = 5.0, exceptions=(Exception,)):
    """
    Decorator: retry a function up to `times` times on specified exceptions.
    Waits `delay` seconds between attempts.
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(1, times + 1):
                try:
                    return fn(*args, **kwargs)
                except exceptions as e:
                    last_exc = e
                    logger.warning(
                        f"[retry] {fn.__name__} attempt {attempt}/{times} failed: {e}"
                    )
                    if attempt < times:
                        time.sleep(delay)
            raise last_exc
        return wrapper
    return decorator
```

---

## 6. `registry.py` — JSON Service Registry

This is the most critical module. Implement it with extreme care.
The file lock must prevent concurrent corruption.

```python
# render_sdk/registry.py

import json
import logging
import shutil
from pathlib import Path

import portalocker

from .exceptions import RegistryCorruptError
from .models import RegistryEntry
from .utils import now_iso

logger = logging.getLogger("render_sdk")

REGISTRY_VERSION = 1


class ServiceRegistry:
    """
    Manages the JSON file that maps local folder paths → Render service metadata.

    File format:
    {
      "version": 1,
      "services": {
        "/absolute/path/to/folder": { ...RegistryEntry fields... },
        ...
      }
    }

    Thread/process safety: every read-modify-write uses an exclusive portalocker lock
    on a sibling .lock file so concurrent deploys cannot corrupt the registry.
    """

    def __init__(self, registry_path: str | Path):
        self.path = Path(registry_path).expanduser().resolve()
        self.lock_path = self.path.with_suffix(".lock")
        self._ensure_exists()

    # ── Private helpers ─────────────────────────────────────────────────────

    def _ensure_exists(self):
        """Create the registry file with an empty structure if it doesn't exist."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write_raw({"version": REGISTRY_VERSION, "services": {}})
            logger.debug(f"[registry] Created new registry at {self.path}")

    def _read_raw(self) -> dict:
        """Read and parse the JSON file. Raises RegistryCorruptError on failure."""
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError as e:
            # Back up the corrupt file before raising
            backup = self.path.with_suffix(".bak")
            shutil.copy2(self.path, backup)
            logger.error(f"[registry] Corrupt registry backed up to {backup}")
            raise RegistryCorruptError(str(self.path), str(e))

    def _write_raw(self, data: dict):
        """Write data to the registry file atomically."""
        tmp = self.path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        tmp.replace(self.path)  # atomic on POSIX

    # ── Public API ──────────────────────────────────────────────────────────

    def lookup(self, normalised_path: str) -> RegistryEntry | None:
        """
        Return the RegistryEntry for a path, or None if not registered.
        This is a read-only operation — no lock needed.
        """
        data = self._read_raw()
        entry_dict = data["services"].get(normalised_path)
        if entry_dict is None:
            logger.debug(f"[registry] MISS for path: {normalised_path}")
            return None
        logger.debug(f"[registry] HIT for path: {normalised_path}")
        return RegistryEntry.from_dict(entry_dict)

    def register(self, normalised_path: str, entry: RegistryEntry):
        """
        Write a new entry. Raises ValueError if path already exists.
        Use update() for subsequent deploys.
        """
        with portalocker.Lock(str(self.lock_path), timeout=30):
            data = self._read_raw()
            if normalised_path in data["services"]:
                raise ValueError(
                    f"Path '{normalised_path}' already registered. Use update() instead."
                )
            data["services"][normalised_path] = entry.to_dict()
            self._write_raw(data)
            logger.info(f"[registry] Registered new service '{entry.service_name}' "
                        f"for path: {normalised_path}")

    def update(self, normalised_path: str, **kwargs):
        """
        Update specific fields of an existing entry.
        Common kwargs: status, last_deployed, deploy_count, live_url.
        """
        with portalocker.Lock(str(self.lock_path), timeout=30):
            data = self._read_raw()
            if normalised_path not in data["services"]:
                raise KeyError(f"Path '{normalised_path}' not in registry. Cannot update.")
            data["services"][normalised_path].update(kwargs)
            self._write_raw(data)
            logger.debug(f"[registry] Updated entry for: {normalised_path} → {kwargs}")

    def remove(self, normalised_path: str) -> bool:
        """
        Delete an entry from the registry. Returns True if deleted, False if not found.
        """
        with portalocker.Lock(str(self.lock_path), timeout=30):
            data = self._read_raw()
            if normalised_path not in data["services"]:
                logger.warning(f"[registry] remove() called for unknown path: {normalised_path}")
                return False
            del data["services"][normalised_path]
            self._write_raw(data)
            logger.info(f"[registry] Removed entry for: {normalised_path}")
            return True

    def list_all(self) -> dict[str, RegistryEntry]:
        """Return all registry entries as a dict keyed by normalised path."""
        data = self._read_raw()
        return {
            path: RegistryEntry.from_dict(entry)
            for path, entry in data["services"].items()
        }

    def count(self) -> int:
        """Return the number of registered services."""
        return len(self._read_raw()["services"])
```

---

## 7. `validator.py` — Dockerfile Validation

```python
# render_sdk/validator.py

import logging
import re
from pathlib import Path

from .exceptions import MissingDockerfileError, PortMissingError, SecretsLeakError

logger = logging.getLogger("render_sdk")

# Patterns that indicate secrets are being copied into the image
SECRET_FILE_PATTERNS = re.compile(
    r"^\s*(COPY|ADD)\s+.*?(\.env|\.env\.\w+|secrets\.ya?ml|credentials\.json)",
    re.IGNORECASE | re.MULTILINE,
)


def validate_project(path: str) -> dict:
    """
    Validate the project folder before building.

    Checks:
    1. Dockerfile exists
    2. EXPOSE directive is present
    3. No secret files are being COPYed into the image

    Returns a dict with:
      - exposed_port (int): the first port found in EXPOSE
      - has_env_port (bool): whether ENV PORT is set
      - warnings (list[str]): non-fatal issues

    Raises:
      MissingDockerfileError, PortMissingError, SecretsLeakError
    """
    project_path = Path(path)
    dockerfile_path = project_path / "Dockerfile"

    # Check 1: Dockerfile exists
    if not dockerfile_path.exists():
        raise MissingDockerfileError(str(path))

    content = dockerfile_path.read_text(encoding="utf-8")
    warnings = []

    # Check 2: EXPOSE directive
    expose_matches = re.findall(r"^\s*EXPOSE\s+(\d+)", content, re.MULTILINE | re.IGNORECASE)
    if not expose_matches:
        raise PortMissingError(str(path))
    exposed_port = int(expose_matches[0])

    # Check 3: Secrets leak
    secret_match = SECRET_FILE_PATTERNS.search(content)
    if secret_match:
        raise SecretsLeakError(str(path), secret_match.group(0).strip())

    # Non-fatal: ENV PORT not set
    has_env_port = bool(re.search(r"^\s*ENV\s+PORT", content, re.MULTILINE | re.IGNORECASE))
    if not has_env_port:
        warnings.append(
            "Dockerfile does not set ENV PORT. SDK will inject ENV PORT=8080 at build time."
        )

    logger.debug(
        f"[validator] OK — exposed_port={exposed_port}, "
        f"has_env_port={has_env_port}, warnings={warnings}"
    )
    return {
        "exposed_port": exposed_port,
        "has_env_port": has_env_port,
        "warnings": warnings,
    }


def generate_fallback_dockerfile(path: str) -> str:
    """
    Generate a minimal Dockerfile for the project if none exists.
    Detects Python (requirements.txt) or Node (package.json).
    Writes the Dockerfile to the project path.
    Returns the Dockerfile content as a string.
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
            f"{path} — could not auto-detect runtime "
            f"(no requirements.txt or package.json found)."
        )

    dockerfile_path = project_path / "Dockerfile"
    dockerfile_path.write_text(content, encoding="utf-8")
    logger.info(f"[validator] Generated {runtime} Dockerfile at {dockerfile_path}")
    return content
```

---

## 8. `docker_builder.py` — Build and Push

```python
# render_sdk/docker_builder.py

import logging
from typing import Callable

import docker
from docker.errors import BuildError, APIError

from .exceptions import DockerBuildError, RegistryPushError
from .utils import retry

logger = logging.getLogger("render_sdk")


class DockerBuilder:
    """
    Wraps docker-py to build and push images.
    Assumes the host machine is already logged into the target Docker registry
    (docker login myregistry.com) or credentials are in ~/.docker/config.json.
    """

    def __init__(self):
        self.client = docker.from_env()

    def build(
        self,
        path: str,
        image_tag: str,
        log_callback: Callable[[str], None] | None = None,
    ) -> str:
        """
        Build a Docker image from the given path.

        Args:
            path:         Absolute path to the project folder (contains Dockerfile)
            image_tag:    Full image reference e.g. "myorg/lead-scraper-a1b2:7"
            log_callback: Optional callable that receives each log line

        Returns:
            The image_tag on success.

        Raises:
            DockerBuildError on failure.
        """
        logger.info(f"[docker] Building image '{image_tag}' from path '{path}'")
        log_output = []

        try:
            _, logs = self.client.images.build(
                path=path,
                tag=image_tag,
                rm=True,           # Remove intermediate containers
                forcerm=True,
                nocache=False,
            )
            for chunk in logs:
                line = chunk.get("stream", chunk.get("status", "")).rstrip()
                if line:
                    log_output.append(line)
                    if log_callback:
                        log_callback(line)
                    else:
                        logger.debug(f"[docker build] {line}")

        except BuildError as e:
            build_log = "\n".join(log_output)
            raise DockerBuildError(image_tag, build_log) from e

        # Also tag as :latest
        latest_tag = image_tag.rsplit(":", 1)[0] + ":latest"
        image = self.client.images.get(image_tag)
        image.tag(latest_tag)
        logger.info(f"[docker] Build complete → {image_tag} (also tagged :latest)")
        return image_tag

    @retry(times=3, delay=5.0, exceptions=(RegistryPushError,))
    def push(
        self,
        image_tag: str,
        log_callback: Callable[[str], None] | None = None,
    ) -> str:
        """
        Push the image (and its :latest alias) to the registry.

        Returns the image_tag on success.
        Raises RegistryPushError after 3 failed attempts.
        """
        logger.info(f"[docker] Pushing '{image_tag}' to registry …")

        base = image_tag.rsplit(":", 1)[0]
        tags_to_push = [image_tag, f"{base}:latest"]

        for tag in tags_to_push:
            try:
                response = self.client.images.push(tag, stream=True, decode=True)
                for chunk in response:
                    if "error" in chunk:
                        raise RegistryPushError(tag, chunk["error"])
                    line = chunk.get("status", "")
                    if line and log_callback:
                        log_callback(f"[push] {line}")
                logger.info(f"[docker] Pushed {tag}")
            except APIError as e:
                raise RegistryPushError(tag, str(e)) from e

        return image_tag
```

---

## 9. `render_api.py` — Render REST API Client

```python
# render_sdk/render_api.py

import logging
import time
import urllib.parse
from typing import Callable

import requests

from .exceptions import ServiceCreateError, DeployError, DeployTimeoutError

logger = logging.getLogger("render_sdk")

RENDER_BASE = "https://api.render.com/v1"

# All terminal deploy statuses
TERMINAL_STATUSES = {"live", "build_failed", "canceled", "deactivated"}
SUCCESS_STATUS    = "live"


class RenderAPIClient:
    """
    Thin client for the Render REST API.
    Handles service creation, deploy hooks, and status polling.
    """

    def __init__(self, api_key: str):
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type":  "application/json",
            "Accept":        "application/json",
        }

    # ── Service Creation ────────────────────────────────────────────────────

    def create_service(
        self,
        service_name: str,
        image_url: str,
        region: str,
        plan: str,
        env_vars: dict | None = None,
        docker_user: str | None = None,
        docker_token: str | None = None,
    ) -> dict:
        """
        Create a new Render web service backed by a Docker image.

        Returns the full API response dict including:
          - service.id
          - service.serviceDetails.url
          - deployId (the initial deploy triggered on creation)

        Raises ServiceCreateError on 4xx/5xx.
        """
        payload: dict = {
            "type":       "web_service",
            "name":       service_name,
            "region":     region,
            "plan":       plan,
            "env":        "image",
            "image":      {"url": image_url},
            "autoDeploy": False,
            "healthCheckPath": "/health",
            "numInstances": 1,
        }

        # Inject docker registry credentials if provided
        if docker_user and docker_token:
            payload["image"]["credentials"] = {
                "username": docker_user,
                "password": docker_token,
            }

        # Inject env vars
        if env_vars:
            payload["envVars"] = [
                {"key": k, "value": str(v)} for k, v in env_vars.items()
            ]

        logger.info(f"[render] Creating service '{service_name}' in region '{region}' …")
        resp = requests.post(f"{RENDER_BASE}/services", json=payload, headers=self.headers)

        if not resp.ok:
            raise ServiceCreateError(resp.status_code, resp.text)

        data = resp.json()
        logger.info(
            f"[render] Service created → id={data['service']['id']}, "
            f"url={data['service']['serviceDetails']['url']}"
        )
        return data

    def get_deploy_hook(self, service_id: str) -> str:
        """
        Retrieve the deploy hook URL for an existing service.
        Render only returns the hook key via their API on GET /services/{id}.
        Parse it and return the full usable URL.
        """
        resp = requests.get(f"{RENDER_BASE}/services/{service_id}", headers=self.headers)
        resp.raise_for_status()
        data = resp.json()

        # The deploy hook is embedded in the service details
        hook_key = data.get("service", {}).get("deployKey", "")
        if not hook_key:
            logger.warning(
                f"[render] No deploy hook key found for {service_id}. "
                f"You may need to enable it in the Render dashboard."
            )
            return ""
        return f"https://api.render.com/deploy/{service_id}?key={hook_key}"

    # ── Redeploy via Hook ───────────────────────────────────────────────────

    def trigger_deploy_hook(self, deploy_hook_url: str, image_url: str) -> str:
        """
        Trigger a redeploy of an existing service using its deploy hook.
        This is the fast path — no service re-creation.

        Returns the deploy_id string from the response.
        Raises requests.HTTPError on failure.
        """
        encoded_image = urllib.parse.quote(image_url, safe="")
        url = f"{deploy_hook_url}&imgURL={encoded_image}"

        logger.info(f"[render] Triggering deploy hook for image '{image_url}' …")
        resp = requests.post(url)
        resp.raise_for_status()

        data = resp.json()
        deploy_id = data.get("id", data.get("deploy", {}).get("id", "unknown"))
        logger.info(f"[render] Deploy triggered → deploy_id={deploy_id}")
        return deploy_id

    # ── Status Polling ──────────────────────────────────────────────────────

    def poll_until_live(
        self,
        service_id: str,
        deploy_id: str,
        poll_interval: int = 10,
        timeout_s: int = 600,
        log_callback: Callable[[str], None] | None = None,
    ) -> str:
        """
        Poll the Render deploys API until the deploy reaches a terminal status.

        Returns "live" on success.
        Raises DeployError on build_failed/canceled.
        Raises DeployTimeoutError if timeout_s is exceeded.
        """
        start = time.time()
        seen_status = None
        _log = log_callback or (lambda msg: logger.info(msg))

        _log(f"[render] Polling deploy {deploy_id} for service {service_id} …")

        while True:
            elapsed = int(time.time() - start)

            if elapsed > timeout_s:
                raise DeployTimeoutError(service_id, timeout_s)

            resp = requests.get(
                f"{RENDER_BASE}/services/{service_id}/deploys",
                params={"limit": 5},
                headers=self.headers,
            )
            resp.raise_for_status()
            deploys = resp.json()

            # Find the deploy we triggered
            current = next(
                (d["deploy"] for d in deploys if d["deploy"]["id"] == deploy_id),
                deploys[0]["deploy"] if deploys else None,
            )

            if current is None:
                _log(f"[{elapsed:>4}s] Waiting for deploy to appear …")
                time.sleep(poll_interval)
                continue

            status = current.get("status", "unknown")

            if status != seen_status:
                _log(f"[{elapsed:>4}s] Deploy status → {status.upper()}")
                seen_status = status

            if status in TERMINAL_STATUSES:
                if status != SUCCESS_STATUS:
                    raise DeployError(service_id, status)
                return status

            time.sleep(poll_interval)

    # ── Env Vars Update ─────────────────────────────────────────────────────

    def update_env_vars(self, service_id: str, env_vars: dict):
        """Patch env vars on an existing service."""
        payload = [{"key": k, "value": str(v)} for k, v in env_vars.items()]
        resp = requests.put(
            f"{RENDER_BASE}/services/{service_id}/env-vars",
            json=payload,
            headers=self.headers,
        )
        resp.raise_for_status()
        logger.info(f"[render] Updated {len(env_vars)} env vars for service {service_id}")

    # ── Service Deletion ────────────────────────────────────────────────────

    def delete_service(self, service_id: str):
        """Permanently delete a Render service."""
        resp = requests.delete(
            f"{RENDER_BASE}/services/{service_id}",
            headers=self.headers,
        )
        resp.raise_for_status()
        logger.info(f"[render] Deleted Render service {service_id}")
```

---

## 10. `log_drain.py` — Optional Runtime Log Streaming

```python
# render_sdk/log_drain.py

import logging
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Callable

logger = logging.getLogger("render_sdk")


class _LogDrainHandler(BaseHTTPRequestHandler):
    """Minimal HTTP handler that receives Render syslog POST payloads."""

    callback: Callable[[str], None] = print  # Class-level, set before starting

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8", errors="replace")
        for line in body.splitlines():
            if line.strip():
                self.callback(f"[app log] {line}")
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        pass  # Silence default access logging


class LocalLogDrain:
    """
    Starts a local HTTP server to receive log drain POSTs from Render.
    Requires ngrok to expose the local port publicly.

    Usage:
        drain = LocalLogDrain(callback=print)
        public_url = drain.start()
        # Pass public_url to Render's log stream config
        # ...
        drain.stop()
    """

    def __init__(self, callback: Callable[[str], None] = print, port: int = 0):
        self.callback = callback
        self.port = port  # 0 = OS picks a free port
        self._server: HTTPServer | None = None
        self._thread: threading.Thread | None = None
        self.public_url: str | None = None

    def start(self) -> str:
        """Start the local drain and open an ngrok tunnel. Returns the public HTTPS URL."""
        try:
            from pyngrok import ngrok
        except ImportError:
            raise ImportError(
                "pyngrok is required for runtime log drain. "
                "Install it: pip install pyngrok"
            )

        _LogDrainHandler.callback = staticmethod(self.callback)
        self._server = HTTPServer(("0.0.0.0", self.port), _LogDrainHandler)
        self.port = self._server.server_address[1]  # Resolve OS-assigned port

        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

        tunnel = ngrok.connect(self.port, "http")
        self.public_url = tunnel.public_url.replace("http://", "https://")
        logger.info(f"[log_drain] Listening on port {self.port}, public URL: {self.public_url}")
        return self.public_url

    def stop(self):
        """Shut down the local server and close the ngrok tunnel."""
        try:
            from pyngrok import ngrok
            ngrok.disconnect(self.public_url)
        except Exception:
            pass
        if self._server:
            self._server.shutdown()
        logger.info("[log_drain] Stopped.")
```

---

## 11. `sdk.py` — Main Orchestrator (Primary Entry Point)

This is the file that callers import. It wires all the above modules together.

```python
# render_sdk/sdk.py

import logging
import os
import time
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv

from .docker_builder import DockerBuilder
from .exceptions import ConcurrentDeployError
from .log_drain import LocalLogDrain
from .models import DeployResult, RegistryEntry
from .registry import ServiceRegistry
from .render_api import RenderAPIClient
from .utils import make_slug, make_image_tag, normalise_path, now_iso
from .validator import validate_project, generate_fallback_dockerfile

load_dotenv()


class RenderSDK:
    """
    The single public class for the Render Deploy SDK.

    One call: sdk.deploy(local_path) → DeployResult with live URL.
    """

    def __init__(
        self,
        api_key:        str | None = None,
        docker_org:     str | None = None,
        docker_user:    str | None = None,
        docker_token:   str | None = None,
        registry_path:  str = "~/.render_sdk/registry.json",
        default_region: str = "fra",
        default_plan:   str = "starter",
        poll_interval:  int = 10,
        poll_timeout:   int = 600,
        log_level:      str = "INFO",
    ):
        # Config — constructor params take precedence over env vars
        self.api_key       = api_key       or os.environ["RENDER_API_KEY"]
        self.docker_org    = docker_org    or os.environ["DOCKER_ORG"]
        self.docker_user   = docker_user   or os.getenv("DOCKER_USER")
        self.docker_token  = docker_token  or os.getenv("DOCKER_TOKEN")
        self.default_region = default_region
        self.default_plan   = default_plan
        self.poll_interval  = poll_interval
        self.poll_timeout   = poll_timeout

        # Sub-modules
        self.registry = ServiceRegistry(registry_path)
        self.render    = RenderAPIClient(self.api_key)
        self.docker    = DockerBuilder()

        # Logging
        logging.basicConfig(
            format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
            datefmt="%H:%M:%S",
        )
        logging.getLogger("render_sdk").setLevel(getattr(logging, log_level.upper()))

    # ── Primary public method ───────────────────────────────────────────────

    def deploy(
        self,
        local_path:            str,
        env_vars:              dict | None = None,
        region:                str | None = None,
        auto_generate_dockerfile: bool = False,
        stream_runtime_logs:   bool = False,
        log_callback:          Callable[[str], None] | None = None,
    ) -> DeployResult:
        """
        Deploy a local folder to Render and return a live URL.

        This is the only method the platform backend needs to call.

        Args:
            local_path:    Absolute or relative path to the project folder.
            env_vars:      Dict of environment variables to inject into the service.
            region:        Render region code. Defaults to self.default_region.
            auto_generate_dockerfile:
                           If True and no Dockerfile found, generate one automatically.
            stream_runtime_logs:
                           If True, open an ngrok log drain after deploy goes live.
            log_callback:  Optional callable for log lines. Defaults to logger.info.

        Returns:
            DeployResult with url, service_id, deploy_id, duration_s, is_new, etc.
        """
        t_start = time.time()
        _log = log_callback or (lambda msg: logging.getLogger("render_sdk").info(msg))
        region = region or self.default_region

        # ── Step 1: Normalise path ──────────────────────────────────────────
        norm_path = normalise_path(local_path)
        _log(f"Deploying path: {norm_path}")

        # ── Step 2: Validate project ────────────────────────────────────────
        try:
            validation = validate_project(norm_path)
        except Exception as e:
            if auto_generate_dockerfile and "MissingDockerfileError" in type(e).__name__:
                _log("No Dockerfile found — generating fallback …")
                generate_fallback_dockerfile(norm_path)
                validation = validate_project(norm_path)
            else:
                raise

        for warning in validation.get("warnings", []):
            _log(f"[warn] {warning}")

        # ── Step 3: Registry lookup ─────────────────────────────────────────
        entry = self.registry.lookup(norm_path)
        is_new = entry is None

        if is_new:
            slug = make_slug(norm_path)
            _log(f"First deploy — new service will be named '{slug}'")
        else:
            slug = entry.service_name
            _log(f"Existing service found: '{slug}' (id={entry.service_id})")

        # ── Step 4: Docker build ────────────────────────────────────────────
        deploy_count = 1 if is_new else (entry.deploy_count + 1)
        image_tag    = make_image_tag(self.docker_org, slug, deploy_count)

        self.docker.build(norm_path, image_tag, log_callback=_log)

        # ── Step 5: Docker push ─────────────────────────────────────────────
        self.docker.push(image_tag, log_callback=_log)

        # ── Step 6: Render action ───────────────────────────────────────────
        if is_new:
            # Create a brand new Render service
            resp = self.render.create_service(
                service_name=slug,
                image_url=f"registry-1.docker.io/{image_tag}",
                region=region,
                plan=self.default_plan,
                env_vars=env_vars,
                docker_user=self.docker_user,
                docker_token=self.docker_token,
            )
            service_id   = resp["service"]["id"]
            live_url     = resp["service"]["serviceDetails"]["url"]
            deploy_id    = resp.get("deployId", "unknown")
            deploy_hook  = self.render.get_deploy_hook(service_id)

            # Persist to registry immediately after creation
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

        else:
            # Reuse existing service via deploy hook (FAST PATH)
            service_id  = entry.service_id
            live_url    = entry.live_url
            deploy_hook = entry.deploy_hook

            if env_vars:
                self.render.update_env_vars(service_id, env_vars)

            deploy_id = self.render.trigger_deploy_hook(
                deploy_hook_url=deploy_hook,
                image_url=f"registry-1.docker.io/{image_tag}",
            )

        # ── Step 7: Poll until live ─────────────────────────────────────────
        self.render.poll_until_live(
            service_id=service_id,
            deploy_id=deploy_id,
            poll_interval=self.poll_interval,
            timeout_s=self.poll_timeout,
            log_callback=_log,
        )

        # ── Step 8: Update registry ─────────────────────────────────────────
        self.registry.update(
            norm_path,
            status="live",
            last_deployed=now_iso(),
            deploy_count=deploy_count,
        )

        duration = round(time.time() - t_start, 1)
        _log(f"✅  Deploy complete in {duration}s → {live_url}")

        # ── Step 9: Optional runtime log drain ─────────────────────────────
        if stream_runtime_logs:
            drain = LocalLogDrain(callback=_log)
            public_url = drain.start()
            _log(f"[log_drain] Runtime logs available at {public_url}")
            # Note: drain runs in background thread; caller must call drain.stop()

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

    # ── Helper methods ──────────────────────────────────────────────────────

    def status(self, local_path: str) -> dict | None:
        """Return registry info for a path, or None if not deployed."""
        norm_path = normalise_path(local_path)
        entry = self.registry.lookup(norm_path)
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
        all_entries = self.registry.list_all()
        return [
            {"path": path, **entry.to_dict()}
            for path, entry in all_entries.items()
        ]

    def stream_logs(self, service_id: str, tail: int = 50):
        """
        Print the last N deploy events for a service to stdout.
        This is the status-log stream, not application runtime logs.
        """
        import requests
        resp = requests.get(
            f"https://api.render.com/v1/services/{service_id}/deploys",
            params={"limit": tail},
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        resp.raise_for_status()
        for item in resp.json():
            d = item["deploy"]
            print(f"[{d.get('updatedAt', '?')}] {d['id']} → {d['status'].upper()}")

    def teardown(self, local_path: str, delete_image: bool = False):
        """
        Delete the Render service and remove the registry entry.
        Optionally remove the Docker image from the registry.
        """
        norm_path = normalise_path(local_path)
        entry = self.registry.lookup(norm_path)
        if entry is None:
            logging.getLogger("render_sdk").warning(
                f"[teardown] No registry entry for '{norm_path}'. Nothing to do."
            )
            return

        self.render.delete_service(entry.service_id)

        if delete_image:
            logging.getLogger("render_sdk").info(
                f"[teardown] Skipping image deletion from registry "
                f"(requires Docker Hub API credentials). Remove manually: {entry.image_repo}"
            )

        self.registry.remove(norm_path)
        logging.getLogger("render_sdk").info(
            f"[teardown] Service '{entry.service_name}' deleted and registry entry removed."
        )
```

---

## 12. `__init__.py` — Public API Surface

```python
# render_sdk/__init__.py

from .sdk import RenderSDK
from .models import DeployResult, RegistryEntry
from .exceptions import (
    RenderSDKError,
    MissingDockerfileError,
    PortMissingError,
    SecretsLeakError,
    DockerBuildError,
    RegistryPushError,
    ServiceCreateError,
    DeployError,
    DeployTimeoutError,
    RegistryCorruptError,
    ConcurrentDeployError,
)

__all__ = [
    "RenderSDK",
    "DeployResult",
    "RegistryEntry",
    "RenderSDKError",
    "MissingDockerfileError",
    "PortMissingError",
    "SecretsLeakError",
    "DockerBuildError",
    "RegistryPushError",
    "ServiceCreateError",
    "DeployError",
    "DeployTimeoutError",
    "RegistryCorruptError",
    "ConcurrentDeployError",
]
```

---

## 13. `cli.py` — Optional Command-Line Interface

```python
# render_sdk/cli.py

import click
from . import RenderSDK


@click.group()
def main():
    """Render Deploy SDK — CLI"""
    pass


@main.command()
@click.argument("path")
@click.option("--env", "-e", multiple=True, help="KEY=VALUE env vars")
@click.option("--region", default="fra", help="Render region (default: fra)")
def deploy(path, env, region):
    """Deploy a local folder to Render."""
    env_vars = dict(e.split("=", 1) for e in env)
    sdk = RenderSDK()
    result = sdk.deploy(path, env_vars=env_vars or None, region=region)
    click.echo(f"\n🚀  Live URL: {result.url}")
    click.echo(f"    Service:  {result.service_name} ({result.service_id})")
    click.echo(f"    Duration: {result.duration_s}s  |  New service: {result.is_new}")


@main.command()
@click.argument("path")
def status(path):
    """Show registry status for a deployed path."""
    sdk = RenderSDK()
    info = sdk.status(path)
    if info is None:
        click.echo(f"No service registered for: {path}")
        return
    for k, v in info.items():
        click.echo(f"  {k:<15}: {v}")


@main.command("list")
def list_services():
    """List all deployed services."""
    sdk = RenderSDK()
    services = sdk.list_services()
    if not services:
        click.echo("No services registered.")
        return
    for svc in services:
        click.echo(f"  {svc['service_name']:<30} {svc['live_url']:<50} [{svc['status']}]")


@main.command()
@click.argument("path")
@click.option("--delete-image", is_flag=True, default=False)
def teardown(path, delete_image):
    """Delete a Render service and remove it from the registry."""
    sdk = RenderSDK()
    sdk.teardown(path, delete_image=delete_image)
    click.echo(f"✅  Teardown complete for: {path}")


@main.command()
@click.argument("service_id")
@click.option("--tail", default=20, help="Number of deploys to show")
def logs(service_id, tail):
    """Show recent deploy logs for a service ID."""
    sdk = RenderSDK()
    sdk.stream_logs(service_id, tail=tail)
```

---

## 14. Final Verification

After building all files, the agent must run these checks:

```bash
# 1. Import check — must print "OK"
python -c "from render_sdk import RenderSDK; print('OK')"

# 2. Unit tests (no credentials needed)
pytest render_sdk/tests/test_registry.py -v
pytest render_sdk/tests/test_validator.py -v

# 3. CLI smoke test
python -m render_sdk.cli --help
render-sdk --help   # if installed via pip install -e .
```

All three must pass before marking the build complete.

---

## 15. Environment File Template

Create this at the project root as `.env.example`:

```bash
# .env.example — copy to .env and fill in real values

RENDER_API_KEY=rnd_xxxxxxxxxxxxxxxxxxxx
DOCKER_ORG=myorganisation
DOCKER_USER=mydockerhubusername
DOCKER_TOKEN=dckr_pat_xxxxxxxxxxxxxxxxxxxx
RENDER_REGION=fra
SDK_REGISTRY_PATH=~/.render_sdk/registry.json
SDK_POLL_INTERVAL=10
SDK_POLL_TIMEOUT=600
# Optional — only needed for runtime log drain
NGROK_AUTHTOKEN=
```