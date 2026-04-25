from ingest.prompts.core import core_triage_instruction

system = (
    core_triage_instruction("Notion")
    + "\n\nContext: Page edits and comments reveal documentation practices and knowledge "
    "sharing patterns."
)
