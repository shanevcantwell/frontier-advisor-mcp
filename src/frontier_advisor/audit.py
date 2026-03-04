"""In-memory session-scoped audit log for advisory consultations."""

import hashlib
from datetime import datetime, timezone


class AdvisoryAuditLog:
    def __init__(self):
        self._entries: list[dict] = []

    def log(self, entry: dict) -> None:
        """Record an audit entry with timestamp and optional question hash."""
        entry["logged_at"] = datetime.now(timezone.utc).isoformat()
        if "question_preview" in entry:
            entry["question_hash"] = hashlib.sha256(
                entry["question_preview"].encode()
            ).hexdigest()[:16]
        self._entries.append(entry)

    def recent(self, n: int = 10) -> list[dict]:
        """Return the last n audit entries from this session."""
        return self._entries[-n:]
