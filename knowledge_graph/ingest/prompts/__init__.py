def integration_system_prompt(integration: str) -> str:
    from importlib import import_module

    m = import_module(f"ingest.prompts.{integration}")
    return m.system


__all__ = [
    "integration_system_prompt",
]
