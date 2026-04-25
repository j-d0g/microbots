# TEST_CASES.md
# Layer 3 — Render Deploy SDK: Complete Test Case Suite

> **How to use this file:**
> Run tests in the order listed. Each test is self-contained.
> Unit tests (Sections 1–4) need no credentials and run offline.
> Integration tests (Section 5) require a real Render API key and Docker daemon.
> E2E tests (Section 6) deploy actual services — they cost Render credits.

---

## Setup

```bash
# Install dev dependencies
pip install pytest pytest-mock responses pytest-cov

# Copy and fill in your credentials
cp .env.example .env
# Edit .env with your RENDER_API_KEY, DOCKER_ORG, DOCKER_USER, DOCKER_TOKEN

# Run all unit tests
pytest render_sdk/tests/ -v --ignore=render_sdk/tests/test_sdk_integration.py

# Run with coverage
pytest render_sdk/tests/ -v --cov=render_sdk --cov-report=term-missing
```

---

## Section 1 — Registry Tests (`test_registry.py`)

Paste the following into `render_sdk/tests/test_registry.py`:

```python
# render_sdk/tests/test_registry.py

import json
import pytest
from pathlib import Path

from render_sdk.registry import ServiceRegistry
from render_sdk.models import RegistryEntry
from render_sdk.exceptions import RegistryCorruptError


SAMPLE_ENTRY = RegistryEntry(
    service_id="srv-test001",
    service_name="test-app-ab12",
    deploy_hook="https://api.render.com/deploy/srv-test001?key=XXXX",
    image_repo="myorg/test-app-ab12",
    region="fra",
    live_url="https://test-app-ab12.onrender.com",
    created_at="2026-04-25T10:00:00+00:00",
    last_deployed="2026-04-25T10:00:00+00:00",
    deploy_count=1,
    status="live",
)


@pytest.fixture
def registry(tmp_path):
    """Fresh registry backed by a temp directory."""
    return ServiceRegistry(tmp_path / "registry.json")


# ── TC-R-01 ─────────────────────────────────────────────────────────────────

class TestRegistryCreation:

    def test_creates_file_on_init(self, tmp_path):
        """TC-R-01: Registry file is created if it does not exist."""
        path = tmp_path / "new_registry.json"
        assert not path.exists()
        ServiceRegistry(path)
        assert path.exists()

    def test_file_has_correct_structure(self, tmp_path):
        """TC-R-02: New registry file has version and empty services dict."""
        path = tmp_path / "registry.json"
        ServiceRegistry(path)
        data = json.loads(path.read_text())
        assert data["version"] == 1
        assert data["services"] == {}

    def test_existing_file_is_not_overwritten(self, tmp_path):
        """TC-R-03: Initialising registry on an existing file preserves data."""
        path = tmp_path / "registry.json"
        reg1 = ServiceRegistry(path)
        reg1.register("/test/path", SAMPLE_ENTRY)

        # Re-initialise on same path
        reg2 = ServiceRegistry(path)
        entry = reg2.lookup("/test/path")
        assert entry is not None
        assert entry.service_id == "srv-test001"


# ── TC-R-02 ─────────────────────────────────────────────────────────────────

class TestLookup:

    def test_miss_returns_none(self, registry):
        """TC-R-04: Lookup on unregistered path returns None."""
        result = registry.lookup("/nonexistent/path")
        assert result is None

    def test_hit_returns_entry(self, registry):
        """TC-R-05: Lookup returns correct RegistryEntry after register."""
        registry.register("/my/project", SAMPLE_ENTRY)
        result = registry.lookup("/my/project")
        assert result is not None
        assert result.service_id == "srv-test001"
        assert result.live_url == "https://test-app-ab12.onrender.com"

    def test_different_paths_are_independent(self, registry):
        """TC-R-06: Two different paths store independent entries."""
        entry_a = RegistryEntry(**{**SAMPLE_ENTRY.__dict__, "service_id": "srv-aaa"})
        entry_b = RegistryEntry(**{**SAMPLE_ENTRY.__dict__, "service_id": "srv-bbb"})
        registry.register("/path/a", entry_a)
        registry.register("/path/b", entry_b)
        assert registry.lookup("/path/a").service_id == "srv-aaa"
        assert registry.lookup("/path/b").service_id == "srv-bbb"


# ── TC-R-03 ─────────────────────────────────────────────────────────────────

class TestRegister:

    def test_register_persists_to_disk(self, registry, tmp_path):
        """TC-R-07: Registered entry is persisted to the JSON file."""
        registry.register("/my/project", SAMPLE_ENTRY)
        raw = json.loads(Path(registry.path).read_text())
        assert "/my/project" in raw["services"]

    def test_duplicate_register_raises(self, registry):
        """TC-R-08: Registering same path twice raises ValueError."""
        registry.register("/my/project", SAMPLE_ENTRY)
        with pytest.raises(ValueError, match="already registered"):
            registry.register("/my/project", SAMPLE_ENTRY)

    def test_count_increments(self, registry):
        """TC-R-09: count() reflects number of registered services."""
        assert registry.count() == 0
        registry.register("/path/one", SAMPLE_ENTRY)
        assert registry.count() == 1


# ── TC-R-04 ─────────────────────────────────────────────────────────────────

class TestUpdate:

    def test_update_changes_fields(self, registry):
        """TC-R-10: update() modifies specific fields without touching others."""
        registry.register("/my/project", SAMPLE_ENTRY)
        registry.update("/my/project", status="deploying", deploy_count=2)
        entry = registry.lookup("/my/project")
        assert entry.status == "deploying"
        assert entry.deploy_count == 2
        assert entry.service_id == "srv-test001"  # Unchanged

    def test_update_unknown_path_raises(self, registry):
        """TC-R-11: update() on unknown path raises KeyError."""
        with pytest.raises(KeyError):
            registry.update("/nonexistent/path", status="live")


# ── TC-R-05 ─────────────────────────────────────────────────────────────────

class TestRemove:

    def test_remove_deletes_entry(self, registry):
        """TC-R-12: remove() deletes entry from registry."""
        registry.register("/my/project", SAMPLE_ENTRY)
        result = registry.remove("/my/project")
        assert result is True
        assert registry.lookup("/my/project") is None

    def test_remove_nonexistent_returns_false(self, registry):
        """TC-R-13: remove() on unknown path returns False (no error)."""
        result = registry.remove("/unknown/path")
        assert result is False

    def test_remove_persists_to_disk(self, registry):
        """TC-R-14: Removed entry is gone from the JSON file."""
        registry.register("/my/project", SAMPLE_ENTRY)
        registry.remove("/my/project")
        raw = json.loads(Path(registry.path).read_text())
        assert "/my/project" not in raw["services"]


# ── TC-R-06 ─────────────────────────────────────────────────────────────────

class TestListAll:

    def test_list_all_returns_all_entries(self, registry):
        """TC-R-15: list_all() returns every registered entry."""
        entry_a = RegistryEntry(**{**SAMPLE_ENTRY.__dict__, "service_id": "srv-aaa"})
        entry_b = RegistryEntry(**{**SAMPLE_ENTRY.__dict__, "service_id": "srv-bbb"})
        registry.register("/path/a", entry_a)
        registry.register("/path/b", entry_b)
        all_entries = registry.list_all()
        assert len(all_entries) == 2
        assert "/path/a" in all_entries
        assert "/path/b" in all_entries

    def test_list_all_empty(self, registry):
        """TC-R-16: list_all() on empty registry returns empty dict."""
        assert registry.list_all() == {}


# ── TC-R-07 ─────────────────────────────────────────────────────────────────

class TestCorruptRegistry:

    def test_corrupt_json_raises_and_backs_up(self, tmp_path):
        """TC-R-17: Corrupt JSON triggers backup and RegistryCorruptError."""
        path = tmp_path / "registry.json"
        path.write_text("{ this is not valid json !!!")
        reg = ServiceRegistry.__new__(ServiceRegistry)
        reg.path = path
        reg.lock_path = path.with_suffix(".lock")

        with pytest.raises(RegistryCorruptError):
            reg._read_raw()

        assert path.with_suffix(".bak").exists()
```

**Run this section:**

```bash
pytest render_sdk/tests/test_registry.py -v
```

**Expected: 17 tests, all PASS.**

---

## Section 2 — Validator Tests (`test_validator.py`)

```python
# render_sdk/tests/test_validator.py

import pytest
from pathlib import Path

from render_sdk.validator import validate_project, generate_fallback_dockerfile
from render_sdk.exceptions import (
    MissingDockerfileError,
    PortMissingError,
    SecretsLeakError,
)


@pytest.fixture
def project_dir(tmp_path):
    """Helper: returns a tmp_path with a valid Dockerfile."""
    def _make(dockerfile_content: str) -> Path:
        d = tmp_path / "project"
        d.mkdir()
        (d / "Dockerfile").write_text(dockerfile_content)
        return d
    return _make


# ── TC-V-01 ─────────────────────────────────────────────────────────────────

class TestMissingDockerfile:

    def test_raises_when_no_dockerfile(self, tmp_path):
        """TC-V-01: Raises MissingDockerfileError when Dockerfile is absent."""
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        with pytest.raises(MissingDockerfileError) as exc_info:
            validate_project(str(empty_dir))
        assert str(empty_dir) in str(exc_info.value)

    def test_error_message_contains_path(self, tmp_path):
        """TC-V-02: Error message includes the offending path."""
        d = tmp_path / "myapp"
        d.mkdir()
        with pytest.raises(MissingDockerfileError, match="myapp"):
            validate_project(str(d))


# ── TC-V-02 ─────────────────────────────────────────────────────────────────

class TestPortValidation:

    def test_raises_when_no_expose(self, project_dir):
        """TC-V-03: Raises PortMissingError when EXPOSE is absent."""
        d = project_dir("FROM python:3.11\nRUN echo hello\n")
        with pytest.raises(PortMissingError):
            validate_project(str(d))

    def test_passes_with_expose(self, project_dir):
        """TC-V-04: Validation passes with EXPOSE 8080."""
        d = project_dir("FROM python:3.11\nEXPOSE 8080\n")
        result = validate_project(str(d))
        assert result["exposed_port"] == 8080

    def test_extracts_correct_port_number(self, project_dir):
        """TC-V-05: Extracts port number correctly from EXPOSE directive."""
        d = project_dir("FROM node:20\nEXPOSE 3000\n")
        result = validate_project(str(d))
        assert result["exposed_port"] == 3000


# ── TC-V-03 ─────────────────────────────────────────────────────────────────

class TestSecretsLeak:

    def test_raises_on_copy_env(self, project_dir):
        """TC-V-06: Raises SecretsLeakError when .env is COPYed into image."""
        d = project_dir("FROM python:3.11\nEXPOSE 8080\nCOPY .env .\n")
        with pytest.raises(SecretsLeakError) as exc_info:
            validate_project(str(d))
        assert ".env" in str(exc_info.value)

    def test_raises_on_add_secrets_yaml(self, project_dir):
        """TC-V-07: Raises SecretsLeakError for secrets.yaml added to image."""
        d = project_dir("FROM python:3.11\nEXPOSE 8080\nADD secrets.yaml /app/\n")
        with pytest.raises(SecretsLeakError):
            validate_project(str(d))

    def test_no_raise_on_safe_copy(self, project_dir):
        """TC-V-08: Safe COPY (non-secret files) does not raise."""
        d = project_dir("FROM python:3.11\nEXPOSE 8080\nCOPY . .\n")
        result = validate_project(str(d))
        assert result is not None


# ── TC-V-04 ─────────────────────────────────────────────────────────────────

class TestEnvPortWarning:

    def test_warning_when_env_port_missing(self, project_dir):
        """TC-V-09: Warning is issued when ENV PORT is not set in Dockerfile."""
        d = project_dir("FROM python:3.11\nEXPOSE 8080\n")
        result = validate_project(str(d))
        assert result["has_env_port"] is False
        assert len(result["warnings"]) > 0

    def test_no_warning_when_env_port_set(self, project_dir):
        """TC-V-10: No warning when ENV PORT is explicitly set."""
        d = project_dir("FROM python:3.11\nENV PORT=8080\nEXPOSE 8080\n")
        result = validate_project(str(d))
        assert result["has_env_port"] is True
        assert len(result["warnings"]) == 0


# ── TC-V-05 ─────────────────────────────────────────────────────────────────

class TestFallbackDockerfile:

    def test_generates_python_dockerfile(self, tmp_path):
        """TC-V-11: Generates Python Dockerfile when requirements.txt exists."""
        d = tmp_path / "pyproject"
        d.mkdir()
        (d / "requirements.txt").write_text("flask\n")
        generate_fallback_dockerfile(str(d))
        dockerfile = (d / "Dockerfile").read_text()
        assert "python:3.11-slim" in dockerfile
        assert "requirements.txt" in dockerfile

    def test_generates_node_dockerfile(self, tmp_path):
        """TC-V-12: Generates Node Dockerfile when package.json exists."""
        d = tmp_path / "nodeproject"
        d.mkdir()
        (d / "package.json").write_text('{"name": "app"}')
        generate_fallback_dockerfile(str(d))
        dockerfile = (d / "Dockerfile").read_text()
        assert "node:20-slim" in dockerfile

    def test_raises_when_runtime_undetectable(self, tmp_path):
        """TC-V-13: Raises MissingDockerfileError when runtime cannot be detected."""
        d = tmp_path / "unknown"
        d.mkdir()
        with pytest.raises(MissingDockerfileError):
            generate_fallback_dockerfile(str(d))
```

**Run this section:**

```bash
pytest render_sdk/tests/test_validator.py -v
```

**Expected: 13 tests, all PASS.**

---

## Section 3 — Utils Tests (inline, no file needed)

Run these as quick sanity checks manually in a Python shell:

```python
from render_sdk.utils import make_slug, make_image_tag, normalise_path, now_iso
from pathlib import Path

# TC-U-01: make_slug produces lowercase hyphenated name
slug = make_slug("/home/agent/workflows/Lead_Scraper_V2")
assert slug.startswith("lead-scraper-v2") or "lead" in slug, f"Unexpected: {slug}"
print(f"TC-U-01 PASS: {slug}")

# TC-U-02: make_slug truncates long names
long_path = "/home/agent/workflows/" + "a" * 100
slug_long = make_slug(long_path)
name_part = slug_long.rsplit("-", 1)[0]
assert len(name_part) <= 30, f"Name part too long: {name_part}"
print(f"TC-U-02 PASS: slug length OK ({len(slug_long)} chars)")

# TC-U-03: Same path always produces same slug (deterministic hash)
slug_a = make_slug("/fixed/path/to/app")
slug_b = make_slug("/fixed/path/to/app")
assert slug_a == slug_b
print(f"TC-U-03 PASS: deterministic slug = {slug_a}")

# TC-U-04: Different paths produce different slugs (collision resistance)
slug_x = make_slug("/project/chatbot")
slug_y = make_slug("/project/scraper")
assert slug_x != slug_y
print(f"TC-U-04 PASS: {slug_x} != {slug_y}")

# TC-U-05: make_image_tag produces correct format
tag = make_image_tag("myorg", "lead-scraper-ab12", 7)
assert tag == "myorg/lead-scraper-ab12:7"
print(f"TC-U-05 PASS: {tag}")

# TC-U-06: normalise_path resolves ~
p = normalise_path("~/some/path")
assert not p.startswith("~")
print(f"TC-U-06 PASS: {p}")

print("\n✅  All utils tests passed.")
```

---

## Section 4 — Render API Client Tests (`test_render_api.py`)

Uses `responses` library to mock HTTP calls — no real Render account needed.

```python
# render_sdk/tests/test_render_api.py

import pytest
import responses as resp_mock
from render_sdk.render_api import RenderAPIClient
from render_sdk.exceptions import ServiceCreateError, DeployError, DeployTimeoutError

API_KEY = "rnd_test_key"
BASE    = "https://api.render.com/v1"


@pytest.fixture
def client():
    return RenderAPIClient(api_key=API_KEY)


# ── TC-A-01 ─────────────────────────────────────────────────────────────────

class TestCreateService:

    @resp_mock.activate
    def test_create_service_success(self, client):
        """TC-A-01: Returns service id and URL on 200 response."""
        resp_mock.add(
            resp_mock.POST, f"{BASE}/services",
            json={
                "service": {
                    "id": "srv-abc123",
                    "serviceDetails": {"url": "https://myapp.onrender.com"},
                },
                "deployId": "dep-xyz789",
            },
            status=200,
        )
        result = client.create_service(
            service_name="myapp-ab12",
            image_url="myorg/myapp-ab12:1",
            region="fra",
            plan="starter",
        )
        assert result["service"]["id"] == "srv-abc123"
        assert result["service"]["serviceDetails"]["url"] == "https://myapp.onrender.com"

    @resp_mock.activate
    def test_create_service_401_raises(self, client):
        """TC-A-02: 401 response raises ServiceCreateError."""
        resp_mock.add(
            resp_mock.POST, f"{BASE}/services",
            json={"message": "Unauthorized"},
            status=401,
        )
        with pytest.raises(ServiceCreateError) as exc_info:
            client.create_service("name", "image", "fra", "starter")
        assert exc_info.value.status_code == 401

    @resp_mock.activate
    def test_create_service_sends_env_vars(self, client):
        """TC-A-03: env_vars are included in the request payload."""
        resp_mock.add(
            resp_mock.POST, f"{BASE}/services",
            json={"service": {"id": "srv-1", "serviceDetails": {"url": "http://x.onrender.com"}},
                  "deployId": "dep-1"},
            status=200,
        )
        client.create_service(
            service_name="app", image_url="img:1",
            region="fra", plan="starter",
            env_vars={"MY_KEY": "my_value"},
        )
        sent_body = resp_mock.calls[0].request.body
        assert "MY_KEY" in sent_body
        assert "my_value" in sent_body


# ── TC-A-02 ─────────────────────────────────────────────────────────────────

class TestDeployHook:

    @resp_mock.activate
    def test_trigger_hook_returns_deploy_id(self, client):
        """TC-A-04: trigger_deploy_hook returns deploy_id from response."""
        hook_url = "https://api.render.com/deploy/srv-abc?key=XXX"
        resp_mock.add(
            resp_mock.POST, hook_url,
            json={"id": "dep-hook-001"},
            status=202,
        )
        deploy_id = client.trigger_deploy_hook(
            hook_url, "myorg/myapp:2"
        )
        assert deploy_id == "dep-hook-001"

    @resp_mock.activate
    def test_trigger_hook_url_encodes_image(self, client):
        """TC-A-05: Image URL is percent-encoded in the deploy hook request."""
        hook_url = "https://api.render.com/deploy/srv-abc?key=XXX"
        resp_mock.add(resp_mock.POST, hook_url, json={"id": "dep-1"}, status=202)
        client.trigger_deploy_hook(hook_url, "myorg/my-app:3")
        called_url = resp_mock.calls[0].request.url
        assert "myorg" in called_url
        assert ":" not in called_url.split("imgURL=")[-1] or "%3A" in called_url


# ── TC-A-03 ─────────────────────────────────────────────────────────────────

class TestPollUntilLive:

    @resp_mock.activate
    def test_poll_returns_live_on_success(self, client):
        """TC-A-06: poll_until_live returns 'live' when status reaches live."""
        resp_mock.add(
            resp_mock.GET, f"{BASE}/services/srv-1/deploys",
            json=[{"deploy": {"id": "dep-1", "status": "live"}}],
            status=200,
        )
        result = client.poll_until_live("srv-1", "dep-1", poll_interval=0, timeout_s=30)
        assert result == "live"

    @resp_mock.activate
    def test_poll_raises_on_build_failed(self, client):
        """TC-A-07: poll_until_live raises DeployError on build_failed status."""
        resp_mock.add(
            resp_mock.GET, f"{BASE}/services/srv-1/deploys",
            json=[{"deploy": {"id": "dep-1", "status": "build_failed"}}],
            status=200,
        )
        with pytest.raises(DeployError):
            client.poll_until_live("srv-1", "dep-1", poll_interval=0, timeout_s=30)

    @resp_mock.activate
    def test_poll_raises_timeout(self, client):
        """TC-A-08: poll_until_live raises DeployTimeoutError after timeout."""
        resp_mock.add(
            resp_mock.GET, f"{BASE}/services/srv-1/deploys",
            json=[{"deploy": {"id": "dep-1", "status": "build_in_progress"}}],
            status=200,
        )
        with pytest.raises(DeployTimeoutError):
            # timeout_s=0 means it times out immediately
            client.poll_until_live("srv-1", "dep-1", poll_interval=0, timeout_s=0)

    @resp_mock.activate
    def test_poll_logs_status_changes(self, client):
        """TC-A-09: Status changes are passed to log_callback."""
        resp_mock.add(
            resp_mock.GET, f"{BASE}/services/srv-1/deploys",
            json=[{"deploy": {"id": "dep-1", "status": "live"}}],
            status=200,
        )
        log_lines = []
        client.poll_until_live(
            "srv-1", "dep-1",
            poll_interval=0, timeout_s=30,
            log_callback=log_lines.append,
        )
        assert any("LIVE" in line for line in log_lines)
```

**Run this section:**

```bash
pytest render_sdk/tests/test_render_api.py -v
```

**Expected: 9 tests, all PASS.**

---

## Section 5 — Integration Tests (`test_sdk_integration.py`)

> ⚠️ These tests mock Docker and Render API calls but test the full `sdk.deploy()` flow.

```python
# render_sdk/tests/test_sdk_integration.py

import pytest
from unittest.mock import MagicMock, patch, call
from render_sdk import RenderSDK
from render_sdk.models import RegistryEntry


FAKE_ENTRY = RegistryEntry(
    service_id="srv-existing",
    service_name="myapp-ab12",
    deploy_hook="https://api.render.com/deploy/srv-existing?key=HOOK",
    image_repo="myorg/myapp-ab12",
    region="fra",
    live_url="https://myapp-ab12.onrender.com",
    created_at="2026-04-01T00:00:00+00:00",
    last_deployed="2026-04-01T00:00:00+00:00",
    deploy_count=3,
    status="live",
)


@pytest.fixture
def sdk(tmp_path):
    """SDK instance with test credentials and temp registry."""
    return RenderSDK(
        api_key="rnd_test",
        docker_org="myorg",
        docker_user="user",
        docker_token="token",
        registry_path=str(tmp_path / "registry.json"),
        poll_interval=0,
        poll_timeout=60,
    )


@pytest.fixture
def valid_project(tmp_path):
    """A minimal valid project folder."""
    d = tmp_path / "myapp"
    d.mkdir()
    (d / "Dockerfile").write_text(
        "FROM python:3.11-slim\nENV PORT=8080\nEXPOSE 8080\nCMD [\"python\", \"main.py\"]\n"
    )
    (d / "main.py").write_text("print('hello')\n")
    return str(d)


# ── TC-I-01 ─────────────────────────────────────────────────────────────────

class TestNewServiceDeploy:

    @patch("render_sdk.sdk.DockerBuilder")
    @patch("render_sdk.sdk.RenderAPIClient")
    def test_new_deploy_creates_service(self, MockRender, MockDocker, sdk, valid_project):
        """TC-I-01: First deploy triggers service creation (not deploy hook)."""
        mock_render = MockRender.return_value
        mock_render.create_service.return_value = {
            "service": {"id": "srv-new123", "serviceDetails": {"url": "https://new.onrender.com"}},
            "deployId": "dep-new456",
        }
        mock_render.get_deploy_hook.return_value = "https://api.render.com/deploy/srv-new123?key=K"
        mock_render.poll_until_live.return_value = "live"

        mock_docker = MockDocker.return_value
        mock_docker.build.return_value = "myorg/myapp-ab12:1"
        mock_docker.push.return_value = "myorg/myapp-ab12:1"

        sdk.docker = mock_docker
        sdk.render = mock_render

        result = sdk.deploy(valid_project)

        mock_render.create_service.assert_called_once()
        mock_render.trigger_deploy_hook.assert_not_called()
        assert result.is_new is True
        assert result.url == "https://new.onrender.com"

    @patch("render_sdk.sdk.DockerBuilder")
    @patch("render_sdk.sdk.RenderAPIClient")
    def test_new_deploy_writes_registry(self, MockRender, MockDocker, sdk, valid_project):
        """TC-I-02: After first deploy, path is written to JSON registry."""
        mock_render = MockRender.return_value
        mock_render.create_service.return_value = {
            "service": {"id": "srv-new", "serviceDetails": {"url": "https://x.onrender.com"}},
            "deployId": "dep-1",
        }
        mock_render.get_deploy_hook.return_value = "https://api.render.com/deploy/srv-new?key=K"
        mock_render.poll_until_live.return_value = "live"

        mock_docker = MockDocker.return_value
        mock_docker.build.return_value = "myorg/x:1"
        mock_docker.push.return_value = "myorg/x:1"

        sdk.docker = mock_docker
        sdk.render = mock_render

        sdk.deploy(valid_project)

        from render_sdk.utils import normalise_path
        entry = sdk.registry.lookup(normalise_path(valid_project))
        assert entry is not None
        assert entry.service_id == "srv-new"


# ── TC-I-02 ─────────────────────────────────────────────────────────────────

class TestExistingServiceDeploy:

    @patch("render_sdk.sdk.DockerBuilder")
    @patch("render_sdk.sdk.RenderAPIClient")
    def test_second_deploy_uses_hook(self, MockRender, MockDocker, sdk, valid_project):
        """TC-I-03: Second deploy of same path uses deploy hook, not create_service."""
        from render_sdk.utils import normalise_path
        norm = normalise_path(valid_project)
        sdk.registry.register(norm, FAKE_ENTRY)

        mock_render = MockRender.return_value
        mock_render.trigger_deploy_hook.return_value = "dep-new"
        mock_render.poll_until_live.return_value = "live"

        mock_docker = MockDocker.return_value
        mock_docker.build.return_value = "myorg/myapp-ab12:4"
        mock_docker.push.return_value = "myorg/myapp-ab12:4"

        sdk.docker = mock_docker
        sdk.render = mock_render

        result = sdk.deploy(valid_project)

        mock_render.create_service.assert_not_called()
        mock_render.trigger_deploy_hook.assert_called_once()
        assert result.is_new is False

    @patch("render_sdk.sdk.DockerBuilder")
    @patch("render_sdk.sdk.RenderAPIClient")
    def test_deploy_count_increments(self, MockRender, MockDocker, sdk, valid_project):
        """TC-I-04: deploy_count in registry increments on each deploy."""
        from render_sdk.utils import normalise_path
        norm = normalise_path(valid_project)
        sdk.registry.register(norm, FAKE_ENTRY)

        mock_render = MockRender.return_value
        mock_render.trigger_deploy_hook.return_value = "dep-new"
        mock_render.poll_until_live.return_value = "live"

        mock_docker = MockDocker.return_value
        mock_docker.build.return_value = "myorg/x:4"
        mock_docker.push.return_value = "myorg/x:4"

        sdk.docker = mock_docker
        sdk.render = mock_render

        sdk.deploy(valid_project)

        entry = sdk.registry.lookup(norm)
        assert entry.deploy_count == 4  # Was 3, now 4


# ── TC-I-03 ─────────────────────────────────────────────────────────────────

class TestStatusAndTeardown:

    def test_status_returns_none_for_unknown(self, sdk, valid_project):
        """TC-I-05: status() returns None for undeployed path."""
        result = sdk.status(valid_project)
        assert result is None

    def test_status_returns_dict_for_known(self, sdk, valid_project):
        """TC-I-06: status() returns dict with url and service_id for known path."""
        from render_sdk.utils import normalise_path
        sdk.registry.register(normalise_path(valid_project), FAKE_ENTRY)
        result = sdk.status(valid_project)
        assert result["url"] == "https://myapp-ab12.onrender.com"
        assert result["service_id"] == "srv-existing"
        assert result["deploy_count"] == 3

    @patch("render_sdk.sdk.RenderAPIClient")
    def test_teardown_removes_from_registry(self, MockRender, sdk, valid_project):
        """TC-I-07: teardown() deletes service and removes registry entry."""
        from render_sdk.utils import normalise_path
        norm = normalise_path(valid_project)
        sdk.registry.register(norm, FAKE_ENTRY)

        mock_render = MockRender.return_value
        sdk.render = mock_render

        sdk.teardown(valid_project)

        mock_render.delete_service.assert_called_once_with("srv-existing")
        assert sdk.registry.lookup(norm) is None


# ── TC-I-04 ─────────────────────────────────────────────────────────────────

class TestEnvVars:

    @patch("render_sdk.sdk.DockerBuilder")
    @patch("render_sdk.sdk.RenderAPIClient")
    def test_env_vars_passed_to_create_service(self, MockRender, MockDocker, sdk, valid_project):
        """TC-I-08: env_vars dict is forwarded to create_service on first deploy."""
        mock_render = MockRender.return_value
        mock_render.create_service.return_value = {
            "service": {"id": "srv-e", "serviceDetails": {"url": "https://e.onrender.com"}},
            "deployId": "dep-e",
        }
        mock_render.get_deploy_hook.return_value = "https://api.render.com/deploy/srv-e?key=K"
        mock_render.poll_until_live.return_value = "live"

        mock_docker = MockDocker.return_value
        mock_docker.build.return_value = "myorg/x:1"
        mock_docker.push.return_value = "myorg/x:1"

        sdk.docker = mock_docker
        sdk.render = mock_render

        sdk.deploy(valid_project, env_vars={"SECRET_KEY": "abc123"})

        call_kwargs = mock_render.create_service.call_args.kwargs
        assert call_kwargs["env_vars"] == {"SECRET_KEY": "abc123"}
```

**Run this section:**

```bash
pytest render_sdk/tests/test_sdk_integration.py -v
```

**Expected: 8 tests, all PASS.**

---

## Section 6 — Manual End-to-End Tests (Real Credentials Required)

> ⚠️ These deploy real services. Run only when you have `RENDER_API_KEY` set.
> Each test will consume Render credits and takes 2–5 minutes.

### E2E-01: First Deploy (New Service)

```bash
# Create a minimal test app
mkdir /tmp/e2e_test_app
cat > /tmp/e2e_test_app/main.py << 'EOF'
from http.server import HTTPServer, BaseHTTPRequestHandler

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"Hello from Render Deploy SDK!"
        self.send_response(200)
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass

HTTPServer(("0.0.0.0", 8080), H).serve_forever()
EOF

cat > /tmp/e2e_test_app/Dockerfile << 'EOF'
FROM python:3.11-slim
WORKDIR /app
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["python", "main.py"]
EOF

cat > /tmp/e2e_test_app/requirements.txt << 'EOF'
EOF

# Deploy
python << 'EOF'
from render_sdk import RenderSDK

sdk = RenderSDK()  # reads from .env
result = sdk.deploy("/tmp/e2e_test_app")

print(f"\n✅  URL:      {result.url}")
print(f"    Service:  {result.service_name}")
print(f"    Is new:   {result.is_new}")
print(f"    Duration: {result.duration_s}s")

# Verify service is accessible
import requests, time
time.sleep(5)  # Brief wait for cold start
resp = requests.get(result.url, timeout=30)
assert resp.status_code == 200
assert b"Hello" in resp.content
print("✅  HTTP check PASSED")
EOF
```

**Expected output:**
```
✅  URL:      https://e2e-test-app-XXXX.onrender.com
    Service:  e2e-test-app-XXXX
    Is new:   True
    Duration: ~90s
✅  HTTP check PASSED
```

---

### E2E-02: Redeploy Same Path (Must Reuse Service)

```bash
# Modify the app and redeploy the same path
cat > /tmp/e2e_test_app/main.py << 'EOF'
from http.server import HTTPServer, BaseHTTPRequestHandler

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"UPDATED: Hello from Render Deploy SDK v2!"
        self.send_response(200)
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass

HTTPServer(("0.0.0.0", 8080), H).serve_forever()
EOF

python << 'EOF'
from render_sdk import RenderSDK

sdk = RenderSDK()
result = sdk.deploy("/tmp/e2e_test_app")

print(f"\n✅  URL:      {result.url}")
print(f"    Is new:   {result.is_new}")   # MUST be False

assert result.is_new is False, "❌ FAIL: Should have reused existing service!"
print("✅  Service reuse CONFIRMED — no new service was created")
EOF
```

**Expected:** `Is new: False` — the same URL as E2E-01.

---

### E2E-03: Registry Status Check

```bash
python << 'EOF'
from render_sdk import RenderSDK

sdk = RenderSDK()
info = sdk.status("/tmp/e2e_test_app")

print(f"URL:          {info['url']}")
print(f"Status:       {info['status']}")
print(f"Deploy count: {info['deploy_count']}")

assert info["deploy_count"] >= 2, "Expected at least 2 deploys"
assert info["status"] == "live"
print("✅  Registry status check PASSED")
EOF
```

---

### E2E-04: Teardown (Cleanup)

```bash
python << 'EOF'
from render_sdk import RenderSDK

sdk = RenderSDK()
sdk.teardown("/tmp/e2e_test_app")

# Confirm it's gone from the registry
info = sdk.status("/tmp/e2e_test_app")
assert info is None, "❌ FAIL: Registry entry should be gone after teardown"
print("✅  Teardown PASSED — service deleted, registry entry removed")
EOF
```

---

## Test Run Order Summary

| Order | Section | Command | Tests | Needs Credentials |
|-------|---------|---------|-------|-------------------|
| 1 | Registry | `pytest tests/test_registry.py -v` | 17 | No |
| 2 | Validator | `pytest tests/test_validator.py -v` | 13 | No |
| 3 | Utils | `python` (inline) | 6 | No |
| 4 | Render API | `pytest tests/test_render_api.py -v` | 9 | No |
| 5 | Integration | `pytest tests/test_sdk_integration.py -v` | 8 | No |
| 6 | E2E-01 | Manual script | 1 | Yes — Docker + Render |
| 7 | E2E-02 | Manual script | 1 | Yes — Docker + Render |
| 8 | E2E-03 | Manual script | 1 | Yes — Render |
| 9 | E2E-04 | Manual script | 1 | Yes — Render |

**Total unit + integration tests: 53 | Total E2E tests: 4**