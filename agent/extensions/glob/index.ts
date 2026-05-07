/**
 * Glob Extension
 *
 * Find files matching a glob pattern. Returns a sorted list of matching
 * absolute paths (capped at 500 results). Uses Node 22's built-in
 * fs/promises.glob.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { glob as globFn } from "node:fs/promises";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "glob",
    label: "Glob",
    description:
      "Find files matching a glob pattern. Returns a sorted list of matching " +
      "absolute paths (up to 500 results).",
    promptSnippet: "Find files matching a glob pattern (glob).",
    promptGuidelines: [
      "Use glob with ** for recursive matching (e.g. **/*.py, src/**/*.ts).",
      "Good for discovering files by extension or name pattern before reading them.",
    ],
    parameters: Type.Object({
      pattern: Type.String({ description: "Glob pattern e.g. **/*.py" }),
      path: Type.Optional(Type.String({ description: "Base directory (default: cwd)" })),
    }),
    async execute(_toolCallId, { pattern, path }, _signal, _onUpdate, _ctx) {
      try {
        const base = path ?? process.cwd();
        const matches: string[] = [];
        for await (const m of globFn(pattern, { cwd: base })) {
          matches.push(`${base}/${m}`);
          if (matches.length >= 500) break;
        }
        matches.sort();
        const text = matches.length === 0 ? "No files matched" : matches.join("\n");
        return {
          content: [{ type: "text", text }],
          details: { matchCount: matches.length },
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