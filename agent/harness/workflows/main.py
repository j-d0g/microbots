from render_sdk import Workflows

app = Workflows()


@app.task
def noop_task() -> dict:
    """Phase 0 cold-start probe. Returns immediately."""
    return {"status": "ok"}


@app.task
def run_user_code(code: str, args: dict | None = None) -> dict:
    """Phase 2 stub. Sandboxed execution not yet implemented."""
    return {"error": "not implemented yet"}


if __name__ == "__main__":
    app.start()
