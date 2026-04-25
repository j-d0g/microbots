from ingest.prompts.core import core_triage_instruction

system = (
    core_triage_instruction("Linear")
    + "\n\nContext: Ticket state changes reveal workflow patterns. Comment threads reveal "
    "decision-making and prioritization."
)
