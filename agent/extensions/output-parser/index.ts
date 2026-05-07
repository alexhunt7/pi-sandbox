/**
 * Output Parser Extension
 *
 * Detects malformed/fenced tool calls in assistant text (```tool blocks,
 * raw JSON in prose) and nudges the model back onto native tool-calling.
 *
 * Does NOT attempt active repair (executing extracted calls). Just detects
 * and queues a follow-up nudge for the next turn.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { parseTextToolCalls } from "./parser.ts";

function extractAssistantText(message: any): string {
  if (!message) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((c) => c?.type === "text").map((c) => c.text).join("\n");
  }
  return "";
}

function hasNativeToolCalls(message: any): boolean {
  const content = message?.content;
  if (!Array.isArray(content)) return false;
  return content.some((c: any) => c?.type === "toolCall");
}

export default function (pi: ExtensionAPI) {
  pi.on("turn_end", async (event, ctx) => {
    const message = (event as any).message;
    if (!message) return;
    // If pi already detected native tool calls, nothing to rescue.
    if (hasNativeToolCalls(message)) return;
    const text = extractAssistantText(message);
    if (!text) return;

    const calls = parseTextToolCalls(text);
    if (calls.length === 0) return;

    const names = calls.map((c) => c.name).join(", ");
    ctx.ui.notify(
      `output-parser: detected ${calls.length} text-embedded tool call(s) [${names}] — nudging to native tool calling`,
      "warning",
    );

    // Queue a follow-up that nudges the model to use native tool calling
    // on its next turn rather than emitting fenced blocks in text.
    pi.sendUserMessage(
      "Your previous response embedded tool calls inside text (e.g. fenced ```tool blocks or raw JSON). " +
      "Please re-issue them as NATIVE tool calls. If the intended calls were: " +
      calls.map((c) => `${c.name}(${JSON.stringify(c.input)})`).join("; ") +
      " — please execute them now using your tool-call channel, not text.",
      { deliverAs: "followUp" },
    );
  });
}