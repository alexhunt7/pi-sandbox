/**
 * Web Search Extension
 *
 * Wraps the web-search Rust binary, exposing `web_search` and `web_fetch`
 * tools to the LLM. Binary must be built first:
 *
 *   cargo build --release --manifest-path ~/.pi/agent/skills/web-search/Cargo.toml
 */

import { homedir } from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";

const BINARY = process.env.WEB_SEARCH_BIN ??
  `${homedir()}/.pi/agent/skills/web-search/target/release/web-search`;

// ---- Search tool ----

const SearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  max: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 5, description: "Max results (default: 5)" })),
  lang: Type.Optional(Type.String({ description: "Language code (e.g. en, de, fr, ja). Default: auto" })),
  region: Type.Optional(Type.String({ description: "Region code (e.g. us, uk, de, jp). Default: auto" })),
  fresh: Type.Optional(StringEnum(["day", "week", "month", "today", "year"] as const, {
    description: "Time filter for recency",
  })),
  extract: Type.Optional(Type.Boolean({
    default: false,
    description: "Extract visible text from top result (default: false)",
  })),
  extractAll: Type.Optional(Type.Boolean({
    default: false,
    description: "Extract visible text from all results (default: false)",
  })),
});

interface SearchDetails {
  query: string;
  resultCount: number;
  truncated?: boolean;
}

// ---- Fetch tool ----

const FetchParams = Type.Object({
  url: Type.String({ description: "URL to fetch and extract text from" }),
  max: Type.Optional(Type.Integer({ minimum: 100, maximum: 50000, default: 8000, description: "Max output characters (default: 8000)" })),
  title: Type.Optional(Type.Boolean({
    default: false,
    description: "Include page title in output (default: false)",
  })),
  source: Type.Optional(Type.Boolean({
    default: false,
    description: "Include source URL in output (default: false)",
  })),
});

interface FetchDetails {
  url: string;
  charCount: number;
  truncated?: boolean;
}

export default function (pi: ExtensionAPI) {
  // ---- web_search tool ----

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web via DuckDuckGo. Returns titles, links, and snippets. " +
      "Use `extract` or `extractAll` to get full page content from results.",
    promptSnippet:
      'Search the web via DuckDuckGo (web_search). Use web_fetch to extract full page text.',
    promptGuidelines: [
      "Use web_search when the user asks to search the web, look up facts, find documentation, or research topics.",
      "Use web_fetch after web_search to read the full content of a specific URL.",
    ],
    parameters: SearchParams,

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const args = ["search", params.query];
      if (params.max) args.push("--max", String(params.max));
      if (params.lang) args.push("--lang", params.lang);
      if (params.region) args.push("--region", params.region);
      if (params.fresh) args.push("--fresh", params.fresh);
      if (params.extract) args.push("--extract");
      if (params.extractAll) args.push("--extract-all");

      const result = await pi.exec(BINARY, args, { signal, timeout: 30_000 });

      if (result.code !== 0) {
        const err = result.stderr || result.stdout || "Search failed";
        throw new Error(err);
      }

      let output = result.stdout.trim();

      // Truncate to avoid overwhelming context
      const truncation = truncateHead(output, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      const details: SearchDetails = {
        query: params.query,
        resultCount: params.max ?? 5,
        truncated: truncation.truncated,
      };

      if (truncation.truncated) {
        output = truncation.content;
        output += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
      }

      return {
        content: [{ type: "text", text: output }],
        details,
      };
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("web_search "));
      text += theme.fg("accent", `"${args.query}"`);
      const extras: string[] = [];
      if (args.max) extras.push(theme.fg("muted", `--max ${args.max}`));
      if (args.lang) extras.push(theme.fg("muted", `--lang ${args.lang}`));
      if (args.region) extras.push(theme.fg("muted", `--region ${args.region}`));
      if (args.fresh) extras.push(theme.fg("muted", `--fresh ${args.fresh}`));
      if (args.extract) extras.push(theme.fg("muted", "--extract"));
      if (args.extractAll) extras.push(theme.fg("muted", "--extract-all"));
      if (extras.length) text += " " + extras.join(" ");
      return new Text(text, 0, 0);
    },

    renderResult(result, { isPartial }, theme, _context) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Searching..."), 0, 0);
      }
      const details = result.details as SearchDetails | undefined;
      let text = theme.fg("success", `${details?.resultCount ?? 0} result${(details?.resultCount ?? 0) !== 1 ? "s" : ""}`);
      if (details?.truncated) {
        text += theme.fg("warning", " (truncated)");
      }
      return new Text(text, 0, 0);
    },
  });

  // ---- web_fetch tool ----

  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and extract its visible text. Uses HTML5 parsing via scraper " +
      "(html5ever). Skips script, style, noscript, iframe, nav, footer, and header tags.",
    promptSnippet:
      'Fetch and extract readable text from a URL (web_fetch).',
    promptGuidelines: [
      "Use web_fetch to read the full content of a URL found via web_search or provided by the user.",
    ],
    parameters: FetchParams,

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const args = ["fetch", params.url];
      if (params.max) args.push("--max", String(params.max));
      if (params.title) args.push("--title");
      if (params.source) args.push("--source");

      const result = await pi.exec(BINARY, args, { signal, timeout: 30_000 });

      if (result.code !== 0) {
        const err = result.stderr || result.stdout || "Fetch failed";
        throw new Error(err);
      }

      let output = result.stdout.trim();

      // Truncate to avoid overwhelming context
      const truncation = truncateHead(output, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      const details: FetchDetails = {
        url: params.url,
        charCount: truncation.totalBytes,
        truncated: truncation.truncated,
      };

      if (truncation.truncated) {
        output = truncation.content;
        output += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
      }

      return {
        content: [{ type: "text", text: output }],
        details,
      };
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("web_fetch "));
      text += theme.fg("accent", args.url);
      const extras: string[] = [];
      if (args.max) extras.push(theme.fg("muted", `--max ${args.max}`));
      if (args.title) extras.push(theme.fg("muted", "--title"));
      if (args.source) extras.push(theme.fg("muted", "--source"));
      if (extras.length) text += " " + extras.join(" ");
      return new Text(text, 0, 0);
    },

    renderResult(result, { isPartial }, theme, _context) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Fetching..."), 0, 0);
      }
      const details = result.details as FetchDetails | undefined;
      let text = theme.fg("success", `${formatSize(details?.charCount ?? 0)}`);
      if (details?.truncated) {
        text += theme.fg("warning", " (truncated)");
      }
      return new Text(text, 0, 0);
    },
  });
}
