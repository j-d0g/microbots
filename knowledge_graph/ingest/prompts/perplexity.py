from ingest.prompts.core import core_triage_instruction

system = (
    core_triage_instruction("Perplexity")
    + "\n\nContext: Async and sync completions show how the user researches (query framing, "
    "models, citations) and which topics they validate before implementation."
)
