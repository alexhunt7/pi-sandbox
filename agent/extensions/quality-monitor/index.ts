/**
 * Quality Monitor Extension
 *
 * Hooks turn_end, inspects the assistant message + previous turn's tool calls,
 * and — if a failure mode is detected — queues a correction user message so
 * the model gets a chance to recover on its next turn.
 *
 * Detects: empty responses, unknown tools, repeated tool calls (loops),
 * malformed arguments.
 *
 * Skips empty_response correction when the model server failed (non-2xx HTTP
 * status or request error) — no point correcting a model that couldn't respond.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { assessResponse, buildCorrectionMessage, type ToolCall } from "./quality.ts";

// Session-scoped state. Pi reuses extensions across turns within a session;
// a fresh extension instance is loaded per session via the session lifecycle.
let previousToolCalls: ToolCall[] = [];
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_CORRECTIONS = 2; // stop nudging after 2 failed corrections

// Track last provider response status. Set via after_provider_response.
// undefined means we have no status info (request may have failed before response).
let lastProviderStatus: number | undefined = undefined;

export default function (pi: ExtensionAPI) {
  // Populate the known-tools set lazily by observing tool_execution events.
  // This avoids needing to read pi's tool registry directly.
  const knownTools = new Set<string>();
  pi.on("tool_execution_start", async (event) => {
    const name = (event as any).toolName;
    if (typeof name === "string") knownTools.add(name);
  });

  pi.on("session_start", async () => {
    previousToolCalls = [];
    consecutiveFailures = 0;
    lastProviderStatus = undefined;
  });

  // Track HTTP status so we can distinguish server failures from real empty responses.
  pi.on("after_provider_response", (event) => {
    lastProviderStatus = (event as any).status;
  });

  pi.on("turn_end", async (event, ctx) => {
    const message = (event as any).message;
    if (!message) return;

    // Extract assistant text + tool calls from pi's content-block format
    const content = Array.isArray(message.content) ? message.content : [];
    const text = content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text ?? "")
      .join("\n");
    const currentCalls: ToolCall[] = content
      .filter((c: any) => c?.type === "toolCall")
      .map((c: any) => ({ name: c.name, input: c.arguments ?? c.input ?? {} }));

    const verdict = assessResponse(text, currentCalls, previousToolCalls, knownTools, lastProviderStatus);

    // Update rolling state for next turn regardless of verdict
    previousToolCalls = currentCalls;
    lastProviderStatus = undefined;

    if (verdict.ok) {
      consecutiveFailures = 0;
      return;
    }

    // Cap corrections so we don't burn turns in a correction loop
    consecutiveFailures++;
    if (consecutiveFailures > MAX_CONSECUTIVE_CORRECTIONS) {
      ctx.ui.notify(
        `quality-monitor: ${verdict.reason} (suppressed after ${consecutiveFailures} in a row)`,
        "warning",
      );
      return;
    }

    const correction = buildCorrectionMessage(verdict.reason);
    ctx.ui.notify(
      `quality-monitor: ${verdict.reason} → queued correction`,
      "warning",
    );
    pi.sendUserMessage(correction, { deliverAs: "followUp" });
  });
}