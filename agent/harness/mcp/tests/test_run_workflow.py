"""Contract tests for ``run_workflow``.

``run_workflow`` is a thin shim: slug → load saved/<slug>.py → delegate to
``run_code``. We mock the Render Workflows client so no network call
escapes. The test surface is:

* missing slug or missing file → error envelope shape
* present file → code is loaded *and* dispatched to ``run_code`` with the
  caller's args (we patch ``run_code`` at module level to a stub).
"""

from __future__ import annotations


class _FakeStarted:
    def __init__(self, run_id: str = "run_test") -> None:
        self.id = run_id


class _FakeDetails:
    """Minimal stand-in for the Render task-run details object."""

    def __init__(
        self,
        status: str = "completed",
        results: list[dict] | None = None,
        error: str = "",
    ) -> None:
        self.status = status
        self.results = results or [
            {"result": None, "stdout": "ok\n", "stderr": "", "error": None}
        ]
        self.error = error


class _FakeWorkflows:
    def __init__(self, details: _FakeDetails) -> None:
        self._details = details
        self.start_calls: list[tuple] = []
        self.get_calls: list[str] = []

    def start_task(self, task_name, payload):
        self.start_calls.append((task_name, payload))
        return _FakeStarted()

    def get_task_run(self, run_id):
        self.get_calls.append(run_id)
        return self._details


class _FakeRender:
    def __init__(self, details: _FakeDetails | None = None) -> None:
        self.workflows = _FakeWorkflows(details or _FakeDetails())


class TestRunWorkflowErrors:
    async def test_missing_workflow_returns_error_envelope(self, server):
        out = await server.run_workflow("nope")
        assert out["error"] and "not found" in out["error"].lower()
        # Standard envelope keys preserved.
        for key in ("result", "stdout", "stderr", "error"):
            assert key in out

    async def test_invalid_name_returns_error_envelope(self, server):
        out = await server.run_workflow("!!!")
        for key in ("result", "stdout", "stderr", "error"):
            assert key in out
        assert out["error"]


class TestRunWorkflowDispatch:
    async def test_present_file_dispatches_to_run_code(self, server, monkeypatch):
        # Save a workflow up front.
        server.save_workflow("greeter", "print('hi')\n")

        # Capture what run_code is called with by patching the module-level
        # function. This isolates run_workflow's responsibility (load + delegate)
        # without exercising the full Render pipeline.
        captured: dict = {}

        async def fake_run_code(code, args=None):
            captured["code"] = code
            captured["args"] = args
            return {"result": "ok", "stdout": "", "stderr": "", "error": None}

        monkeypatch.setattr(server, "run_code", fake_run_code)

        out = await server.run_workflow("greeter", {"name": "world"})
        assert out == {"result": "ok", "stdout": "", "stderr": "", "error": None}
        assert captured["code"] == "print('hi')\n"
        assert captured["args"] == {"name": "world"}

    async def test_dispatch_with_no_args_passes_none(self, server, monkeypatch):
        server.save_workflow("noargs", "pass\n")
        seen: dict = {}

        async def fake_run_code(code, args=None):
            seen["args"] = args
            return {"result": None, "stdout": "", "stderr": "", "error": None}

        monkeypatch.setattr(server, "run_code", fake_run_code)
        await server.run_workflow("noargs")
        # Either None or {} would be reasonable; the contract is "args
        # forwarded as-is when omitted by caller". We assert the falsy shape.
        assert not seen["args"]


class TestRunWorkflowRenderMocked:
    """Exercises the full ``run_workflow`` → ``run_code`` → Render path
    with the Render client mocked out, to guarantee no network escape and
    to lock the envelope shape end-to-end.
    """

    async def test_full_path_with_fake_render_client(self, server, monkeypatch):
        server.save_workflow("ping", "print('pong')\n")

        fake = _FakeRender(
            _FakeDetails(
                status="completed",
                results=[{
                    "result": 42,
                    "stdout": "pong\n",
                    "stderr": "",
                    "error": None,
                }],
            )
        )
        # The lazy ``_render()`` factory caches into ``_render_client``; we
        # short-circuit by pre-populating that module attribute.
        monkeypatch.setattr(server, "_render_client", fake)

        out = await server.run_workflow("ping", {"x": 1})
        for key in ("result", "stdout", "stderr", "error"):
            assert key in out
        assert out["result"] == 42
        assert out["stdout"] == "pong\n"
        # Confirm Render was actually consulted (not a dispatch short-circuit).
        assert fake.workflows.start_calls, "Render start_task was not called"
