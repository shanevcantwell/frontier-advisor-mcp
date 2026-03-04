"""Tests for AdvisoryAuditLog."""

from frontier_advisor.audit import AdvisoryAuditLog


class TestAdvisoryAuditLog:
    def test_log_appends_entries(self):
        log = AdvisoryAuditLog()
        log.log({"event": "first"})
        log.log({"event": "second"})
        assert len(log.recent(10)) == 2

    def test_log_adds_timestamp(self):
        log = AdvisoryAuditLog()
        log.log({"event": "test"})
        entry = log.recent(1)[0]
        assert "logged_at" in entry

    def test_log_adds_question_hash(self):
        log = AdvisoryAuditLog()
        log.log({"event": "test", "question_preview": "what is X?"})
        entry = log.recent(1)[0]
        assert "question_hash" in entry
        assert len(entry["question_hash"]) == 16

    def test_log_no_hash_without_preview(self):
        log = AdvisoryAuditLog()
        log.log({"event": "test"})
        entry = log.recent(1)[0]
        assert "question_hash" not in entry

    def test_recent_returns_last_n(self):
        log = AdvisoryAuditLog()
        for i in range(10):
            log.log({"event": f"entry_{i}"})
        recent = log.recent(3)
        assert len(recent) == 3
        assert recent[0]["event"] == "entry_7"
        assert recent[2]["event"] == "entry_9"

    def test_recent_empty_log(self):
        log = AdvisoryAuditLog()
        assert log.recent() == []

    def test_same_question_same_hash(self):
        log = AdvisoryAuditLog()
        log.log({"question_preview": "what is X?"})
        log.log({"question_preview": "what is X?"})
        entries = log.recent(2)
        assert entries[0]["question_hash"] == entries[1]["question_hash"]
