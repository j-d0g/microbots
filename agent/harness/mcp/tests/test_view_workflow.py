"""Contract tests for ``view_workflow``.

The tool is the read-back partner to ``save_workflow`` — its primary job is
to round-trip source unchanged. We assert the dict shape and basic byte
fidelity, not exact string formatting.
"""

from __future__ import annotations


class TestViewWorkflowRoundTrip:
    def test_save_then_view_returns_identical_code(self, server):
        code = '"""Hello workflow."""\nprint("hi")\n'
        saved = server.save_workflow("My Hello", code)
        assert "saved_to" in saved and "url" in saved

        viewed = server.view_workflow("My Hello")
        # Contract shape.
        for key in ("name", "slug", "code", "bytes"):
            assert key in viewed, f"missing key {key} in {viewed}"
        # Byte fidelity.
        assert viewed["code"] == code
        assert viewed["bytes"] == len(code.encode("utf-8"))
        assert viewed["slug"] == "my-hello"
        assert viewed["name"] == "My Hello"

    def test_view_after_overwrite_returns_latest_code(self, server):
        # save_workflow refuses to overwrite by default (silent-overwrite
        # prevention). Must opt-in with overwrite=True.
        server.save_workflow("alpha", "v1\n")
        server.save_workflow("alpha", "v2\n", overwrite=True)
        assert server.view_workflow("alpha")["code"] == "v2\n"


class TestViewWorkflowMissing:
    def test_missing_workflow_returns_error(self, server):
        out = server.view_workflow("does-not-exist")
        assert "error" in out
        assert "not found" in out["error"].lower()

    def test_invalid_name_produces_empty_slug_error(self, server):
        out = server.view_workflow("!!!")
        assert "error" in out
        # Either flavor is acceptable: invalid-slug or not-found.
        assert "invalid" in out["error"].lower() or "not found" in out["error"].lower()

    def test_empty_name_returns_error(self, server):
        out = server.view_workflow("")
        assert "error" in out
