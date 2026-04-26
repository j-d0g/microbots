"""Contract tests for ``list_workflows``.

Asserts the returned shape ``{workflows: [...], count: N}`` and the
ordering invariant (most-recently-modified first). Each entry must carry
``slug``, ``summary``, ``bytes``, ``modified``.
"""

from __future__ import annotations

import os
import time


class TestListWorkflowsEmpty:
    def test_empty_dir_returns_empty_envelope(self, server):
        out = server.list_workflows()
        assert out == {"workflows": [], "count": 0}


class TestListWorkflowsContents:
    def test_count_matches_number_of_saved_files(self, server):
        server.save_workflow("alpha", '"""Alpha summary."""\n')
        server.save_workflow("beta", '"""Beta summary."""\n')
        out = server.list_workflows()
        assert out["count"] == 2
        slugs = {w["slug"] for w in out["workflows"]}
        assert slugs == {"alpha", "beta"}

    def test_each_entry_has_required_keys(self, server):
        server.save_workflow("only", '"""solo."""\n')
        entry = server.list_workflows()["workflows"][0]
        for key in ("slug", "summary", "bytes", "modified"):
            assert key in entry, f"missing {key} in {entry}"
        assert isinstance(entry["bytes"], int) and entry["bytes"] > 0
        assert isinstance(entry["modified"], (int, float))

    def test_summary_uses_docstring_when_present(self, server):
        server.save_workflow("doc", '"""This is the summary."""\nprint("hi")\n')
        entry = server.list_workflows()["workflows"][0]
        assert entry["summary"] == "This is the summary."

    def test_summary_falls_back_to_first_meaningful_line(self, server):
        server.save_workflow("nodoc", "import os\nprint('hi')\n")
        entry = server.list_workflows()["workflows"][0]
        assert entry["summary"] == "print('hi')"


class TestListWorkflowsOrdering:
    def test_sorted_most_recent_first(self, server):
        server.save_workflow("oldest", '"""old."""\n')
        path_old = server.SAVED_DIR / "oldest.py"
        # Backdate the older file by a healthy margin to avoid mtime
        # resolution flakiness across filesystems.
        old_ts = time.time() - 60
        os.utime(path_old, (old_ts, old_ts))

        server.save_workflow("newer", '"""new."""\n')

        out = server.list_workflows()
        assert [w["slug"] for w in out["workflows"]] == ["newer", "oldest"]
