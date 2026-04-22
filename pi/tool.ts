/**
 * consult_advisor tool definition — standalone, importable by any harness.
 *
 * No pi-coding-agent dependency. Just @sinclair/typebox for schema validation.
 * Used by the pi extension and any future integration.
 */

import { Type } from "@sinclair/typebox";

export const CONSULT_PARAMS = Type.Object({
  question: Type.String({ description: "The question to ask the frontier model. Be precise." }),
  context: Type.Optional(Type.String({ description: "Supporting context the frontier model needs. Only what is necessary." })),
  system_prompt: Type.Optional(Type.String({ description: "Override the default advisory system prompt." })),
});

export const CONSULT_TOOL_DEFINITION = {
  name: "consult_advisor",
  label: "Consult Advisor",
  description:
    "Consult a frontier AI model for advisory input. " +
    "Use when local capabilities are insufficient — " +
    "complex reasoning, architecture decisions, novel synthesis, " +
    "or factual verification beyond training data. " +
    "Frame the question precisely.",
  promptSnippet:
    "Consult frontier models (Opus 4.7 / GPT-4.1) for complex reasoning and advisory input",
  promptGuidelines: [
    "Use for complex reasoning, architecture decisions, or novel synthesis beyond local model capabilities",
    "Frame the question precisely; include only necessary context",
    "Local model is technically competent — the frontier model treats it as a peer",
  ],
  parameters: CONSULT_PARAMS,
} as const;
