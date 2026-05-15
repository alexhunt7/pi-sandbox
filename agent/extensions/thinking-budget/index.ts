import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// Thinking-budget cap with partial-trace preservation.
//
// When thinking tokens exceed the budget mid-stream:
//   1. Abort the current turn via ctx.abort()
//   2. On message_end, replace the aborted message in-place with the partial
//      trace + truncation marker (preserves all ThinkingContent blocks)
//   3. On turn_end, disable thinking and queue a follow-up nudge
//
// _replaceMessageInPlace in agent-session.js mutates the message object
// shared by agent-core's context.messages, so the replacement is definitive
// and visible to all subsequent processing (persistence, next turns, etc.).
//
// Idempotency (issue #8):
//   - State resets on agent_start AND turn_start.
//   - recoveryPending gates re-entry during mid-flight recovery.
//   - setImmediate yield prevents follow-up drop on fast-streaming backends.

const DEFAULT_BUDGET = 6144;
const TRUNCATION_MARKER = "\n\n[thinking truncated — budget exceeded]";

// Per-run rolling state (reset on agent_start)
let thinkingChars = 0;
let budgetForTurn = DEFAULT_BUDGET;
let recoveryPending = false;

function charsToTokens(chars: number): number {
  // Matches local/context_manager.estimate_tokens (len/3.5)
  return Math.ceil(chars / 3.5);
}

/**
 * Build a replacement assistant message that preserves the partial thinking
 * trace and appends a truncation marker as the last text block.
 */
function buildRecoveryMessage(
  content: Array<{ type: string; [k: string]: unknown }>,
  meta: {
    api: string;
    provider: string;
    model: string;
    usage: object;
    timestamp: number;
  },
) {
  const newContent: typeof content = [];

  for (const block of content) {
    if (block.type === "thinking") {
      // Preserve thinking blocks verbatim — this is the partial trace.
      newContent.push(block);
    } else if (block.type === "text") {
      // Append truncation marker to the last text block.
      const text = (block.text as string) || "";
      newContent.push({ ...block, text: text + TRUNCATION_MARKER });
    } else {
      newContent.push(block);
    }
  }

  // If there was no text block, add one with just the marker.
  if (!content.some((b) => b.type === "text")) {
    newContent.push({ type: "text", text: TRUNCATION_MARKER });
  }

  return {
    role: "assistant" as const,
    content: newContent,
    api: meta.api,
    provider: meta.provider,
    model: meta.model,
    usage: meta.usage,
    stopReason: "aborted" as const,
    timestamp: meta.timestamp,
  };
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_start", async () => {
    thinkingChars = 0;
    recoveryPending = false;
  });

  pi.on("before_agent_start", async (event) => {
    const opts: any = (event as any).systemPromptOptions ?? {};
    const lc = opts.littleCoder ?? {};
    const profileBudget = Number(lc.thinkingBudget);
    const envBudget = Number(process.env.LITTLE_CODER_THINKING_BUDGET);
    budgetForTurn =
      (Number.isFinite(profileBudget) && profileBudget > 0 && profileBudget) ||
      (Number.isFinite(envBudget) && envBudget > 0 && envBudget) ||
      DEFAULT_BUDGET;
  });

  pi.on("turn_start", async () => {
    thinkingChars = 0;
  });

  // ── Detect budget breach and abort ──

  pi.on("message_update", async (event, ctx) => {
    const ev: any = (event as any).assistantMessageEvent;
    if (!ev) return;
    if (ev.type !== "thinking_delta") return;
    const delta = typeof ev.delta === "string" ? ev.delta : "";
    thinkingChars += delta.length;
    if (recoveryPending) return;
    const tokens = charsToTokens(thinkingChars);
    if (tokens > budgetForTurn) {
      recoveryPending = true;
      ctx.ui.notify(
        `thinking-budget: ${tokens} > ${budgetForTurn} — aborting, preserving partial trace`,
        "warning",
      );
      ctx.abort();
    }
  });

  // ── Replace aborted message with partial trace + truncation marker ──

  pi.on("message_end", async (event) => {
    if (!recoveryPending) return;

    const msg: any = (event as any).message;
    if (!msg || msg.role !== "assistant") return;

    const meta = {
      api: msg.api ?? "openai-completions",
      provider: msg.provider ?? "unknown",
      model: msg.model ?? "unknown",
      usage: msg.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      timestamp: msg.timestamp ?? Date.now(),
    };

    return { message: buildRecoveryMessage(msg.content ?? [], meta) };
  });

  // ── Disable thinking + send follow-up nudge ──

  pi.on("turn_end", async (_event, _ctx) => {
    if (!recoveryPending) return;

    // Yield one tick so pi's abort barrier settles before we queue the
    // follow-up. On fast-streaming local backends (qwen3.6 / llama.cpp)
    // queuing immediately after ctx.abort() drops the follow-up silently
    // and the agent appears to stop with no message — issue #8.
    await new Promise<void>((r) => setImmediate(r));
    pi.setThinkingLevel("off");
    pi.sendUserMessage(
      "[thinking budget exceeded] Please commit to an implementation now. Stop deliberating and use your tools to make progress.",
      { deliverAs: "followUp" },
    );
    recoveryPending = false;
  });
}
