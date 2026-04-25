from ingest.prompts.core import core_triage_instruction

system = (
    core_triage_instruction("Gmail")
    + "\n\nContext: Email threads reveal external relationships, business communications, "
    "and decisions made outside of internal tools."
)
