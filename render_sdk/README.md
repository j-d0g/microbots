# Render Deploy SDK

> **One call. Local folder in. Live URL out.**
> Designed to be called by an AI agent. No manual steps, no dashboard, no Git.

---

## What This SDK Does

```
sdk.deploy("/home/agent/workflows/lead-scraper")
                    ↓
   Validates Dockerfile → Builds Docker image → Pushes to registry
                    ↓
   Checks JSON registry → Reuses existing Render service OR creates new one
                    ↓
   Polls until live → Updates registry → Returns DeployResult(url=...)
```

The SDK maintains a local `registry.json` that maps every local folder path to its
Render service. If you deploy the same folder twice, the second call reuses the
existing service via a deploy hook — no duplicate services, no extra cost.

---

## Requirements

- Python 3.11+
- Docker daemon running on the host (`docker info` must succeed)
- A [Render](https://render.com) account with an API key
- A Docker Hub account (or compatible registry)

---

## Installation

```bash
# From the repo root
pip install -e .

# With dev dependencies (for running tests)
pip install -e ".[dev]"
```

---

## Configuration

Create a `.env` file in your working directory (or set environment variables):

```bash
# Required
RENDER_API_KEY=rnd_xxxxxxxxxxxxxxxxxxxx
DOCKER_ORG=your-dockerhub-org
DOCKER_USER=your-dockerhub-username
DOCKER_TOKEN=dckr_pat_xxxxxxxxxxxxxxxxxxxx

# Optional (these are the defaults)
RENDER_REGION=fra                            # Frankfurt EU — change to "ore" for US West
SDK_REGISTRY_PATH=~/.render_sdk/registry.json
SDK_POLL_INTERVAL=10                         # Seconds between status checks
SDK_POLL_TIMEOUT=600                         # Max seconds to wait for live (10 min)
```

**Get your Render API key:** Render Dashboard → Account Settings → API Keys → Create API Key

**Get your Docker token:** Docker Hub → Account Settings → Security → New Access Token

---

## Quickstart

### For Agents (Minimum Viable Call)

```python
from render_sdk import RenderSDK

sdk = RenderSDK()  # reads all config from .env / environment

result = sdk.deploy("/absolute/path/to/generated/code")
print(result.url)   # https://your-app-ab12.onrender.com  ← give this to the user
```

That's it. The agent does not need to know anything about Docker, Render, or the registry.

---

### For Platform Backend (Django Task / Celery Worker)

```python
# tasks.py (called after agent finishes generating code)

from render_sdk import RenderSDK, DeployResult
from render_sdk.exceptions import RenderSDKError

sdk = RenderSDK(
    api_key       = settings.RENDER_API_KEY,
    docker_org    = settings.DOCKER_ORG,
    docker_user   = settings.DOCKER_USER,
    docker_token  = settings.DOCKER_TOKEN,
    registry_path = settings.SDK_REGISTRY_PATH,
    default_region= "fra",
    poll_interval = 10,
    poll_timeout  = 600,
)

def deploy_workflow(local_path: str, env_vars: dict | None = None) -> dict:
    """
    Called by the platform after the agent writes code to local_path.
    Returns a dict the API can send back to the frontend.
    """
    try:
        result: DeployResult = sdk.deploy(
            local_path=local_path,
            env_vars=env_vars,
        )
        return {
            "success":    True,
            "url":        result.url,
            "service_id": result.service_id,
            "is_new":     result.is_new,
            "duration_s": result.duration_s,
        }
    except RenderSDKError as e:
        return {
            "success": False,
            "error":   str(e),
        }
```

---

## Project Structure Your Agent Must Produce

Before calling `sdk.deploy(path)`, the agent must write a valid project folder.
The minimum required structure is:

```
/path/to/generated/code/
├── Dockerfile         ← REQUIRED. Must have EXPOSE and a CMD.
├── main.py            ← (or index.js, app.py — whatever runs your app)
└── requirements.txt   ← (or package.json for Node)
```

### Minimum Valid Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["python", "main.py"]
```

### Rules the Dockerfile Must Follow

| Rule | Why |
|------|-----|
| Must have `EXPOSE {port}` | SDK validates this — deploy is blocked without it |
| Must not `COPY .env` | SDK blocks secrets leaking into the image |
| Should set `ENV PORT=8080` | Render uses `PORT` env var to route traffic |
| Must have `CMD` or `ENTRYPOINT` | Container must know how to start |

### Auto-generated Dockerfile (Fallback)

If the agent omits the Dockerfile, pass `auto_generate_dockerfile=True`:

```python
result = sdk.deploy(path, auto_generate_dockerfile=True)
```

The SDK detects the runtime from `requirements.txt` (Python) or `package.json` (Node)
and generates a minimal Dockerfile. Always prefer the agent generating its own.

---

## Full API Reference

### `RenderSDK(…)` — Constructor

```python
sdk = RenderSDK(
    api_key="rnd_...",          # Render API key (or set RENDER_API_KEY env var)
    docker_org="myorg",         # Docker Hub org  (or set DOCKER_ORG)
    docker_user="myuser",       # Docker Hub user (or set DOCKER_USER)
    docker_token="dckr_pat_...",# Docker Hub token (or set DOCKER_TOKEN)
    registry_path="~/.render_sdk/registry.json",  # JSON registry location
    default_region="fra",       # Render region: "fra" (EU) or "ore" (US West)
    default_plan="starter",     # Render plan: "starter" | "standard" | "pro"
    poll_interval=10,           # Seconds between status polls
    poll_timeout=600,           # Max wait time in seconds
    log_level="INFO",           # "DEBUG" | "INFO" | "WARNING"
)
```

---

### `sdk.deploy(local_path, …)` → `DeployResult`

The primary method. Call this after the agent writes code.

```python
result = sdk.deploy(
    local_path="/path/to/code",         # Required — absolute or relative path
    env_vars={"API_KEY": "secret"},     # Optional — injected into Render service
    region="fra",                       # Optional — overrides default_region
    auto_generate_dockerfile=False,     # Optional — generate Dockerfile if missing
    stream_runtime_logs=False,          # Optional — open ngrok log drain post-deploy
    log_callback=my_logger.info,        # Optional — receives each log line
)
```

**Returns `DeployResult`:**

```python
result.url          # "https://your-app-ab12.onrender.com"
result.service_id   # "srv-abc123xyz"
result.deploy_id    # "dep-xyz789"
result.service_name # "your-app-ab12"
result.image_tag    # "myorg/your-app-ab12:3"
result.duration_s   # 87.4  (seconds from call to live)
result.is_new       # True if a brand new Render service was created
result.region       # "fra"
```

---

### `sdk.status(local_path)` → `dict | None`

Check the current state of a deployed path without making any changes.
Returns `None` if the path has never been deployed.

```python
info = sdk.status("/path/to/code")

if info is None:
    print("Not deployed yet")
else:
    print(info["url"])           # Live URL
    print(info["status"])        # "live" | "deploying" | "build_failed"
    print(info["deploy_count"])  # How many times this path has been deployed
    print(info["last_deployed"]) # ISO-8601 timestamp
    print(info["service_id"])    # Render service ID
```

---

### `sdk.list_services()` → `list[dict]`

Returns all services tracked in the registry. Useful for a platform dashboard.

```python
services = sdk.list_services()
for svc in services:
    print(svc["path"])          # Local folder path
    print(svc["live_url"])      # Render URL
    print(svc["service_name"])  # Render service name
    print(svc["deploy_count"])  # Total deploys
    print(svc["status"])        # Current status
```

---

### `sdk.stream_logs(service_id, tail=50)`

Print the last N deploy events to stdout. Uses the deploy status history,
not application runtime logs.

```python
sdk.stream_logs("srv-abc123", tail=20)
# Output:
# [2026-04-25T10:01:00] dep-001 → LIVE
# [2026-04-25T10:00:30] dep-001 → UPDATE_IN_PROGRESS
# [2026-04-25T10:00:10] dep-001 → BUILD_IN_PROGRESS
```

---

### `sdk.teardown(local_path, delete_image=False)`

Delete the Render service and remove the entry from the local registry.
Use this when a user's workflow is permanently deleted.

```python
sdk.teardown("/path/to/code")
# Deletes Render service, removes JSON registry entry
# delete_image=True logs a warning to manually remove from Docker Hub
```

---

## The JSON Registry

The registry lives at `~/.render_sdk/registry.json` (configurable).
You can inspect it directly:

```bash
cat ~/.render_sdk/registry.json
```

```json
{
  "version": 1,
  "services": {
    "/home/agent/workflows/lead-scraper": {
      "service_id":    "srv-abc123",
      "service_name":  "lead-scraper-a1b2",
      "deploy_hook":   "https://api.render.com/deploy/srv-abc123?key=XXXX",
      "image_repo":    "myorg/lead-scraper-a1b2",
      "region":        "fra",
      "live_url":      "https://lead-scraper-a1b2.onrender.com",
      "created_at":    "2026-04-25T10:30:00+00:00",
      "last_deployed": "2026-04-25T14:22:11+00:00",
      "deploy_count":  7,
      "status":        "live"
    }
  }
}
```

**The key is always the normalised absolute path.** Do not edit this file manually
while a deploy is running. The SDK uses a file lock to prevent corruption.

> **For multi-instance platforms:** If your Django app runs on multiple servers,
> store the registry in Postgres instead of a local file. Use `registry.py` as
> a reference and swap the backend.

---

## CLI Usage

If installed with `pip install -e .`, the `render-sdk` command is available:

```bash
# Deploy a folder
render-sdk deploy /path/to/code

# Deploy with env vars
render-sdk deploy /path/to/code -e API_KEY=abc123 -e PORT=8080

# Deploy to a specific region
render-sdk deploy /path/to/code --region ore

# Check status
render-sdk status /path/to/code

# List all deployed services
render-sdk list

# View recent deploy logs
render-sdk logs srv-abc123 --tail 20

# Teardown (delete service + remove from registry)
render-sdk teardown /path/to/code
```

---

## Error Reference

All errors inherit from `RenderSDKError`. Catch the base class or specific ones:

```python
from render_sdk.exceptions import (
    MissingDockerfileError,   # No Dockerfile found in path
    PortMissingError,         # Dockerfile has no EXPOSE directive
    SecretsLeakError,         # .env or secrets file being COPYed into image
    DockerBuildError,         # docker build returned non-zero exit code
    RegistryPushError,        # docker push failed after 3 retries
    ServiceCreateError,       # Render API rejected service creation (4xx/5xx)
    DeployError,              # Deploy ended with build_failed or canceled status
    DeployTimeoutError,       # Deploy did not go live within poll_timeout seconds
    RegistryCorruptError,     # registry.json could not be parsed (backup created)
    ConcurrentDeployError,    # Same path is already being deployed (file lock held)
)

try:
    result = sdk.deploy(path)
except MissingDockerfileError:
    # Tell the agent to generate a Dockerfile and retry
    pass
except DeployTimeoutError:
    # Tell the user deploy is still in progress — check Render dashboard
    pass
except RenderSDKError as e:
    # Catch-all for any other SDK error
    print(f"Deploy failed: {e}")
```

---

## Logging

The SDK logs to the `render_sdk` logger. Set `log_level="DEBUG"` to see all
Docker build output, API calls, and registry operations:

```python
sdk = RenderSDK(log_level="DEBUG")
```

Or plug in your own callback to capture logs per-deploy:

```python
deploy_logs = []

result = sdk.deploy(
    path,
    log_callback=lambda msg: deploy_logs.append(msg)
)
# deploy_logs now contains every status message from this deploy
```

---

## Regions

| Code | Location | Best For |
|------|----------|----------|
| `fra` | Frankfurt, EU | EU users — lowest latency from London |
| `ore` | Oregon, US West | US West Coast users |
| `ohio` | Ohio, US East | US East Coast users |
| `sgp` | Singapore | Asia Pacific users |

Default is `fra`. Override per deploy:

```python
sdk.deploy(path, region="ore")
```

---

## FAQ

**Q: Will calling `deploy()` twice on the same path create two Render services?**

No. The second call checks the JSON registry, finds the existing mapping, and
uses the deploy hook to update the running service. No new service is ever created
for a path that has already been deployed.

**Q: What if I move the code folder to a new path?**

The registry key is the absolute path. Moving the folder to a new path is treated
as a brand new deployment and creates a new Render service. The old entry in the
registry becomes stale — run `sdk.teardown(old_path)` to clean it up, then
`sdk.deploy(new_path)` to deploy from the new location.

**Q: Can the agent call `deploy()` concurrently for multiple different paths?**

Yes. Each path is an independent deploy and they do not conflict. The file lock
only prevents two concurrent deploys of the *same* path.

**Q: How do I pass secrets without them ending up in the Docker image?**

Pass them via `env_vars`:
```python
sdk.deploy(path, env_vars={"DATABASE_URL": "postgres://...", "SECRET_KEY": "..."})
```
The SDK pushes these to Render's environment variable store, not into the image.

**Q: The deploy timed out. What do I do?**

Check the Render dashboard for build logs. The service may still be building.
Increase `poll_timeout` if your images are large:
```python
sdk = RenderSDK(poll_timeout=1200)  # 20 minutes
```

**Q: Can I use a private registry instead of Docker Hub?**

Yes. Set `DOCKER_ORG` to your registry prefix (e.g., `ghcr.io/myorg`) and ensure
the host machine is logged in (`docker login ghcr.io`). The image push will target
that registry automatically.