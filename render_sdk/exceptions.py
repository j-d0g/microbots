"""Custom exception hierarchy for the Render Deploy SDK.

Every other module imports from here. All errors inherit from
:class:`RenderSDKError` so callers can ``except RenderSDKError`` to catch
everything this package might raise.
"""

from __future__ import annotations


class RenderSDKError(Exception):
    """Base class for all SDK errors."""


class MissingDockerfileError(RenderSDKError):
    """Raised when no Dockerfile is found in the project path.

    ``reason`` is an optional override for the default message — used by
    :func:`validator.generate_fallback_dockerfile` when it can't auto-detect
    a runtime (no ``requirements.txt`` or ``package.json``).
    """

    def __init__(self, path: str, reason: str | None = None):
        message = reason or (
            f"No Dockerfile found in '{path}'. "
            "The agent must generate a Dockerfile before calling deploy()."
        )
        super().__init__(message)
        self.path = path


class PortMissingError(RenderSDKError):
    """Raised when Dockerfile does not expose a port."""

    def __init__(self, path: str):
        super().__init__(
            f"Dockerfile in '{path}' has no EXPOSE directive. "
            "Add 'EXPOSE 8080' (or your chosen port)."
        )
        self.path = path


class SecretsLeakError(RenderSDKError):
    """Raised when .env or secret files are being COPYed into the image."""

    def __init__(self, path: str, offending_line: str):
        super().__init__(
            f"Dockerfile in '{path}' copies a secrets file: '{offending_line}'. "
            "Add .env to .dockerignore and use --env-file or env_vars dict instead."
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
        self.reason = reason


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
            f"Deploy for service '{service_id}' ended with status '{status}'. {reason}".rstrip()
        )
        self.service_id = service_id
        self.status = status
        self.reason = reason


class DeployTimeoutError(RenderSDKError):
    """Raised when deploy polling exceeds the timeout."""

    def __init__(self, service_id: str, timeout_s: int):
        super().__init__(
            f"Deploy for service '{service_id}' did not go live within {timeout_s}s. "
            "Check the Render dashboard for build logs."
        )
        self.service_id = service_id
        self.timeout_s = timeout_s


class RegistryCorruptError(RenderSDKError):
    """Raised when the JSON registry file cannot be parsed."""

    def __init__(self, registry_path: str, reason: str):
        super().__init__(
            f"Registry file '{registry_path}' is corrupt: {reason}. "
            "A backup has been saved with a .bak extension."
        )
        self.registry_path = registry_path
        self.reason = reason


class ConcurrentDeployError(RenderSDKError):
    """Raised when the same path is already being deployed by another process."""

    def __init__(self, path: str):
        super().__init__(
            f"A deploy for path '{path}' is already in progress (file lock held). "
            "Wait for it to complete before redeploying."
        )
        self.path = path
