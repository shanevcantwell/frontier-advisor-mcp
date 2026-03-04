"""Advisory tier definitions.

Local model picks the tier, not the provider. Each tier maps to a
list of models tried in order (provider fallback).
"""

ADVISORY_TIERS = {
    "quick": {
        "description": "Fast verification. Syntax, factual checks, sanity checks.",
        "max_tokens": 512,
        "model_preference": ["claude-haiku-4-5-20251001", "gpt-4.1-mini"],
    },
    "standard": {
        "description": "Substantive reasoning about a complex question.",
        "max_tokens": 2048,
        "model_preference": ["claude-sonnet-4-5-20250929", "gpt-4.1"],
    },
    "deep": {
        "description": "Extended analysis. Architecture, novel synthesis. Use sparingly.",
        "max_tokens": 4096,
        "model_preference": ["claude-opus-4-6", "o3"],
    },
}
