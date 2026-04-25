from ingest.prompts.core import core_triage_instruction

system = (
    core_triage_instruction("Slack")
    + "\n\nContext: Messages include channel names, usernames, timestamps. "
    "Thread replies may be grouped. Pay attention to who initiates discussions, "
    "who gets asked questions (indicates expertise), and what topics drive the most engagement."
)
