/**
 * Write Guard Extension
 *
 * Overrides pi's built-in Write tool to refuse overwriting existing files.
 * Forces the model to use Edit for modifications, preventing accidental
 * whole-file overwrites.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "write",
    label: "Write",
    description:
      "Create a NEW file with the given content. Refuses if the file already exists — " +
      "use Edit to modify existing files. Parent directories are created automatically.",
    parameters: Type.Object({
      file_path: Type.String({ description: "Absolute file path" }),
      content: Type.String({ description: "Full file content" }),
    }),
    async execute(_toolCallId, { file_path, content }, _signal, _onUpdate, _ctx) {
      if (existsSync(file_path)) {
        const recipe =
          `Error: Write refused — ${file_path} already exists.\n` +
          `\n` +
          `Write is only for creating NEW files. To change an existing file, use Edit:\n` +
          `  {"name": "edit", "input": {"path": "${file_path}", ` +
          `"oldText": "<exact text currently in the file>", ` +
          `"newText": "<replacement text>"}}\n` +
          `\n` +
          `If you do not already know the file's current content, Read it first to ` +
          `get the exact text for oldText. Include enough surrounding context ` +
          `(2-3 lines) to make oldText unique in the file.\n` +
          `\n` +
          `For multiple changes, emit multiple Edit calls — one per location. Do NOT ` +
          `retry Write; it will be refused again.`;
        return {
          content: [{ type: "text", text: recipe }],
          details: {},
          isError: true,
        };
      }

      try {
        mkdirSync(dirname(file_path), { recursive: true });
        writeFileSync(file_path, content, { encoding: "utf-8" });
        const lineCount = content.split("\n").length;
        return {
          content: [{ type: "text", text: `Created ${file_path} (${lineCount} lines)` }],
          details: {},
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
          details: {},
          isError: true,
        };
      }
    },
  });
}