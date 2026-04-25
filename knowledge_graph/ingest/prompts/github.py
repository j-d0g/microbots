from ingest.prompts.core import core_triage_instruction

system = (
    core_triage_instruction("GitHub")
    + "\n\nContext: PR descriptions and review comments reveal code ownership, review patterns, "
    "and technical decisions. Issue discussions reveal project priorities and blockers."
)
