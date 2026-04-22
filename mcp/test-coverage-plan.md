# Test Coverage Expansion Plan

## Final Results

**Final Coverage**: 99% (97/98 statements covered)

**Achieved**: 37 passing tests across 2 test files

| Module | Coverage | Status |
|--------|----------|--------|
| `adapter.py` | 100% | ✅ Complete |
| `server.py` | 97% | ✅ Complete (1 line intentionally excluded) |

**Excluded Line**: Line 121 (`if __name__ == "__main__": main()`) - This is the script entry point that cannot be tested without blocking execution. Conventionally excluded from coverage requirements.

---

## Original Baseline

**Starting Coverage**: 55% (44/98 statements uncovered)

**Closed Issues**: None (fresh codebase)

---

## Uncovered Modules (ranked by gap size)

### 1. `adapter.py` - 49% coverage (31 missing lines)

**Missing lines**: 61, 89-106, 113-115, 118-141, 148-165

| Lines | Function/Block | Description |
|-------|---------------|-------------|
| 61 | `_get_provider_config` | `return None` for unknown provider |
| 89-106 | `consult` | Success path: API call, response handling, return |
| 105-106 | `consult` | Exception handling (fallback logic) |
| 113-115 | `_call` | Provider routing to `_anthropic` or `_openai` |
| 118-141 | `_anthropic` | Full Anthropic API integration |
| 148-165 | `_openai` | Full OpenAI API integration |

### 2. `server.py` - 64% coverage (13 missing lines)

**Missing lines**: 72, 80-95, 109-110, 117, 121

| Lines | Function/Block | Description |
|-------|---------------|-------------|
| 72 | `call_tool` | Success path for `consult_advisor` |
| 80-95 | `_handle_consult` | Full handler: extract args, call adapter, handle errors |
| 95-105 | `_handle_consult` | Success response formatting |
| 109-110 | `run` | Async context manager for stdio_server |
| 117, 121 | `main` | Entry point |

---

## Phased Test Implementation

### Phase 1: Adapter Success Paths ✅ COMPLETE

**Tests Added** (test_adapter.py):
- `TestAdapterAnthropic.test_anthropic_success` - Anthropic API success with response parsing
- `TestAdapterAnthropic.test_anthropic_with_context` - Context injected via XML tags
- `TestAdapterOpenAI.test_openai_success` - OpenAI API success with response parsing
- `TestAdapterOpenAI.test_openai_with_context` - Context injected in user message
- `TestAdapterOpenAI.test_openai_custom_base_url` - Custom ANTHROPIC_BASE_URL handling

**Approach**: Used `pytest-respx` for HTTP mocking with `route.side_effect` pattern to capture request bodies

### Phase 2: Adapter Edge Cases ✅ COMPLETE

**Tests Added** (test_adapter.py):
- `TestAdapterInit.test_get_provider_config_unknown_provider` - Unknown provider returns None
- `TestAdapterFallback.test_fallback_anthropic_to_openai` - Anthropic fails, OpenAI succeeds
- `TestAdapterFallback.test_fallback_prefers_anthropic` - Both succeed, Anthropic preferred
- `TestAdapterInit.test_no_keys_raises_runtime_error` - No API keys raises RuntimeError
- `TestAdapterAnthropic.test_anthropic_multiple_content_blocks` - Filters non-text blocks
- `TestAdapterAnthropic.test_anthropic_http_error` - HTTP errors trigger fallback

### Phase 3: Server Handler Success Path ✅ COMPLETE

**Tests Added** (test_server.py):
- `TestHandleConsult.test_consult_success` - Full success path with all metadata fields
- `TestHandleConsult.test_consult_with_custom_system_prompt` - Custom system prompt override
- `TestHandleConsult.test_consult_empty_system_prompt_uses_default` - Empty string → None
- `TestHandleConsult.test_consult_empty_context` - Empty context preserved
- `TestCallToolConsultAdvisor.test_call_consult_advisor_success` - Full integration path

### Phase 4: Server Error Handling ✅ COMPLETE

**Tests Added** (test_server.py):
- `TestHandleConsult.test_consult_runtime_error_returns_error_json` - RuntimeError returns error JSON
- `TestCallTool.test_unknown_tool_returns_error` - Unknown tool name returns error

### Phase 5: Server Entry Points ✅ COMPLETE

**Tests Added** (test_server.py):
- `TestServerEntryPoint.test_main_calls_asyncio_run` - main() calls asyncio.run(run())
- `TestServerEntryPoint.test_run_uses_stdio_server` - run() uses stdio_server context manager

**Note**: Line 121 (`if __name__ == "__main__": main()`) intentionally excluded - cannot test without blocking

---

## Decisions Made

1. **Line 61 coverage**: Added test `test_get_provider_config_unknown_provider` - defensive code should still be tested

2. **Server entry points**: Created integration-style tests with mocked stdio streams using async context managers. Line 121 excluded as it's the script entry point

3. **HTTP mocking library**: Used `pytest-respx` (already available) with the `route.side_effect = callback` pattern for capturing request bodies

4. **Environment isolation**: Used `monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)` in tests expecting default URLs

## Test Patterns Established

- **HTTP Mocking**: `route.side_effect = lambda request: ...` with closure to capture request data
- **Context Verification**: Parse request body to verify XML tags (Anthropic) or message structure (OpenAI)
- **Fallback Testing**: Mock first provider to raise HTTPError, second to succeed
- **Async Context Managers**: Create classes with `__aenter__`/`__aexit__` for mocking stdio_server
