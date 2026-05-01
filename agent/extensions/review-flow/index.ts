/**
 * Review Flow Extension - Implementer/Reviewer iterative loop
 *
 * Manages a structured plan → implement → review → fix loop.
 *
 * Commands:
 *   /review-flow <goal>       Start the flow for a goal
 *   /review-status            Show current flow status
 *   /review-approve           Force-approve current review (bypass issues)
 *   /review-fix <issue>       Tell implementer to fix a specific issue
 *
 * Flow:
 *   1. Planner: reads codebase, writes plan
 *   2. Implementer: executes plan
 *   3. Reviewer: checks implementation against plan
 *   4. If issues → Implementer re-does with feedback → Reviewer re-checks
 *   5. Loop up to max_iterations (default 3)
 *
 * State persisted to .pi/review-flow.json for resilience.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlowState {
  goal: string;
  plan: string;
  iteration: number;
  maxIterations: number;
  status: "planning" | "implementing" | "reviewing" | "fixing" | "complete" | "failed";
  implementerOutput?: string;
  reviewerOutput?: string;
  reviewerVerdict?: "pass" | "needs_work" | null;
  reviewerIssues?: string;
  lastFeedback?: string;
  startedAt: number;
  completedAt?: number;
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

const FLOW_FILE = ".pi/review-flow.json";

function getFlowFilePath(cwd: string): string {
  return path.join(cwd, FLOW_FILE);
}

function loadFlowState(cwd: string): FlowState | null {
  try {
    const raw = fs.readFileSync(getFlowFilePath(cwd), "utf-8");
    return JSON.parse(raw) as FlowState;
  } catch {
    return null;
  }
}

function saveFlowState(cwd: string, state: FlowState): void {
  const filePath = getFlowFilePath(cwd);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Subagent spawning (mirrors subagent extension logic)
// ---------------------------------------------------------------------------

interface SubagentResult {
  agent: string;
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; contextTokens: number; turns: number };
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) return { command: process.execPath, args };
  return { command: "pi", args };
}

const SUBAGENT_TIMEOUT_MS = 300_000; // 5 minutes per subagent

async function spawnSubagent(
  cwd: string,
  agentName: string,
  task: string,
  signal?: AbortSignal,
): Promise<SubagentResult> {
  const userAgentsDir = path.join(getAgentDir(), "agents");
  const projectAgentsDir = findProjectAgentsDir(cwd);

  // Load agent config
  const agentConfig = loadAgentConfig(userAgentsDir, agentName) ?? loadAgentConfig(projectAgentsDir, agentName);
  if (!agentConfig) {
    const available = listAgentNames(userAgentsDir)
      .concat(listAgentNames(projectAgentsDir))
      .join(", ") || "none";
    return {
      agent: agentName, task, exitCode: 1, messages: [], stderr: `Agent "${agentName}" not found. Available: ${available}`,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
    };
  }

  const args: string[] = ["--mode", "json", "-p", "--no-session"];
  if (agentConfig.model) args.push("--model", agentConfig.model);
  if (agentConfig.tools?.length) args.push("--tools", agentConfig.tools.join(","));

  // Write system prompt to temp file
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-review-flow-"));
  const tmpPath = path.join(tmpDir, `prompt-${agentName}.md`);
  await fs.promises.writeFile(tmpPath, agentConfig.systemPrompt, { encoding: "utf-8", mode: 0o600 });
  args.push("--append-system-prompt", tmpPath);

  const result: SubagentResult = {
    agent: agentName, task, exitCode: 0, messages: [], stderr: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
  };

  try {
    args.push(task);

    return await new Promise<SubagentResult>((resolve) => {
      const invocation = getPiInvocation(args);
      const proc = spawn(invocation.command, invocation.args, {
        cwd, shell: false, stdio: ["ignore", "pipe", "pipe"],
      });

      let buffer = "";
      let aborted = false;
      let timedOut = false;

      // Timeout: kill after 5 minutes
      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
      }, SUBAGENT_TIMEOUT_MS);

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: any;
        try { event = JSON.parse(line); } catch { return; }
        if (event.type === "message_end" && event.message) {
          const msg = event.message as Message;
          result.messages.push(msg);
          if (msg.role === "assistant") {
            result.usage.turns++;
            const u = msg.usage;
            if (u) {
              result.usage.input += u.input || 0;
              result.usage.output += u.output || 0;
              result.usage.cacheRead += u.cacheRead || 0;
              result.usage.cacheWrite += u.cacheWrite || 0;
              result.usage.cost += u.cost?.total || 0;
              result.usage.contextTokens = u.totalTokens || 0;
            }
            if (!result.model && msg.model) result.model = msg.model;
            if (msg.stopReason) result.stopReason = msg.stopReason;
            if (msg.errorMessage) result.errorMessage = msg.errorMessage;
          }
        }
        if (event.type === "tool_result_end" && event.message) {
          result.messages.push(event.message as Message);
        }
      };

      proc.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });

      proc.stderr.on("data", (data) => {
        result.stderr += data.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timeoutId);
        if (buffer.trim()) processLine(buffer);
        result.exitCode = code ?? 0;
        if (timedOut) {
          result.stderr = `Subagent timed out after ${SUBAGENT_TIMEOUT_MS / 1000}s`;
        }
        resolve(result);
      });

      proc.on("error", () => {
        clearTimeout(timeoutId);
        resolve(result);
      });

      if (signal) {
        const kill = () => { aborted = true; proc.kill("SIGTERM"); setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000); };
        if (signal.aborted) kill();
        else signal.addEventListener("abort", kill, { once: true });
      }
    });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Agent config loading
// ---------------------------------------------------------------------------

interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
}

function parseFrontmatter<T extends Record<string, string>>(content: string): { frontmatter: T; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {} as T, body: content };
  const fm: T = {} as T;
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      (fm as any)[key] = val;
    }
  }
  return { frontmatter: fm, body: match[2].trim() };
}

function loadAgentConfig(dir: string | undefined, name: string): AgentConfig | null {
  if (!dir) return null;
  const filePath = path.join(dir, `${name}.md`);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf-8");
  const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
  const tools = frontmatter.tools?.split(",").map((t: string) => t.trim()).filter(Boolean);
  return {
    name: frontmatter.name ?? name,
    description: frontmatter.description ?? "",
    tools,
    model: frontmatter.model,
    systemPrompt: body,
  };
}

function listAgentNames(dir: string | undefined): string[] {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
}

function findProjectAgentsDir(cwd: string): string | undefined {
  let current = cwd;
  while (true) {
    const candidate = path.join(current, ".pi", "agents");
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch { /* continue */ }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") return part.text;
      }
    }
  }
  return "";
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  return `${Math.round(count / 1000)}k`;
}

function formatUsage(usage: SubagentResult["usage"], model?: string): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

function statusIcon(status: FlowState["status"]): string {
  const icons: Record<FlowState["status"], string> = {
    planning: "📋", implementing: "🔨", reviewing: "🔍", fixing: "🔧", complete: "✅", failed: "❌",
  };
  return icons[status];
}

function formatFlowStatus(state: FlowState): string {
  const totalElapsed = Math.round(((state.completedAt ?? Date.now()) - state.startedAt) / 1000);
  const mins = Math.floor(totalElapsed / 60);
  const secs = totalElapsed % 60;

  let text = `**Review Flow** ${statusIcon(state.status)}\n`;
  text += `Goal: ${state.goal}\n`;
  text += `Iteration: ${state.iteration}/${state.maxIterations}\n`;

  if (state.plan) {
    const preview = state.plan.split("\n").slice(0, 4).join("\n");
    text += `\n**Plan:**\n\`\`\`\n${preview}\n\`\`\`\n`;
  }
  if (state.implementerOutput) {
    const preview = state.implementerOutput.split("\n").slice(0, 5).join("\n");
    text += `\n**Implementation:**\n\`\`\`\n${preview}\n\`\`\`\n`;
  }
  if (state.reviewerOutput) {
    const preview = state.reviewerOutput.split("\n").slice(0, 5).join("\n");
    text += `\n**Review:**\n\`\`\`\n${preview}\n\`\`\`\n`;
  }
  if (state.reviewerIssues) {
    text += `\n**Issues:** ${state.reviewerIssues.slice(0, 200)}\n`;
  }

  text += `\nElapsed: ${mins}m ${secs}s`;
  return text;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildPlannerPrompt(goal: string): string {
  return `Create a detailed implementation plan for this goal:

${goal}

First explore the codebase to understand the current structure. Use read, grep, find, and ls to understand:
- What files are involved?
- What are the relevant functions/classes?
- What testing framework is used?
- What is the code style?

Then produce a plan in this format:

## Goal
One sentence summary.

## Current State
What exists now.

## Plan
Numbered steps, each small and actionable:
1. Step one - specific file/function to modify
2. Step two - what to add/change

## Files to Modify
- path/to/file.ts - what changes

## New Files (if any)
- path/to/new.ts - purpose

## Tests
- What tests to run / update / add

Be concrete and specific. A separate implementer agent will execute this plan verbatim.`;
}

function buildImplementerPrompt(goal: string, plan: string, feedback?: string, previousOutput?: string): string {
  let prompt = `You are implementing code changes. Execute the following plan:

## Goal
${goal}

## Plan
${plan}`;

  if (previousOutput) {
    prompt += `

## Previous Implementation Output
${previousOutput}

Use this as a starting point. Preserve correct parts and fix the issues below.`;
  }

  if (feedback) {
    prompt += `

## Review Feedback - Fix These Issues
${feedback}`;
  }

  prompt += `

Follow each step carefully. After completing all changes, run relevant tests or linting to verify.

Report your results.`;

  return prompt;
}

function buildReviewerPrompt(goal: string, plan: string, implementerOutput: string): string {
  return `You are reviewing an implementation. Evaluate whether it correctly fulfills the plan.

## Goal
${goal}

## Plan
${plan}

## Implementer Output
${implementerOutput}

Review carefully:
1. Does the implementation match the plan?
2. Are there bugs or regressions?
3. Is the code consistent with the codebase style?
4. Are tests updated/added?

Read the actual modified files to verify. Run tests/linters if possible.

Provide your verdict and specific feedback.`;
}

// ---------------------------------------------------------------------------
// Flow executor
// ---------------------------------------------------------------------------

async function runFlow(cwd: string, goal: string, maxIterations: number, signal?: AbortSignal): Promise<FlowState> {
  const state: FlowState = {
    goal, plan: "", iteration: 1, maxIterations, status: "planning", startedAt: Date.now(),
  };
  saveFlowState(cwd, state);

  // Step 1: Plan
  state.status = "planning";
  saveFlowState(cwd, state);

  const planTask = buildPlannerPrompt(goal);
  const planResult = await spawnSubagent(cwd, "planner", planTask, signal);
  if (planResult.exitCode !== 0 || planResult.stopReason === "error") {
    state.status = "failed";
    state.completedAt = Date.now();
    state.reviewerIssues = `Planning failed: ${planResult.stderr || planResult.errorMessage || "unknown error"}`;
    saveFlowState(cwd, state);
    return state;
  }
  state.plan = getFinalOutput(planResult.messages);
  saveFlowState(cwd, state);

  // Step 2-N: Implement → Review loop
  for (; state.iteration <= state.maxIterations; state.iteration++) {
    // Implement
    state.status = "implementing";
    saveFlowState(cwd, state);

    const implTask = buildImplementerPrompt(goal, state.plan, state.lastFeedback, state.implementerOutput);
    const implResult = await spawnSubagent(cwd, "implementer", implTask, signal);
    if (implResult.exitCode !== 0 || implResult.stopReason === "error") {
      state.status = "failed";
      state.completedAt = Date.now();
      state.reviewerIssues = `Implementation failed at iteration ${state.iteration}: ${implResult.stderr || implResult.errorMessage || "unknown error"}`;
      saveFlowState(cwd, state);
      return state;
    }
    state.implementerOutput = getFinalOutput(implResult.messages);
    saveFlowState(cwd, state);

    // Review
    state.status = "reviewing";
    saveFlowState(cwd, state);

    const revTask = buildReviewerPrompt(goal, state.plan, state.implementerOutput);
    const revResult = await spawnSubagent(cwd, "reviewer", revTask, signal);
    if (revResult.exitCode !== 0 || revResult.stopReason === "error") {
      state.status = "failed";
      state.completedAt = Date.now();
      state.reviewerIssues = `Review failed at iteration ${state.iteration}: ${revResult.stderr || revResult.errorMessage || "unknown error"}`;
      saveFlowState(cwd, state);
      return state;
    }
    state.reviewerOutput = getFinalOutput(revResult.messages);

    // Parse verdict
    const firstLine = state.reviewerOutput.split("\n")[0] || "";
    if (firstLine.startsWith("PASS:")) {
      state.reviewerVerdict = "pass";
      state.status = "complete";
      state.completedAt = Date.now();
      saveFlowState(cwd, state);
      return state;
    } else {
      state.reviewerVerdict = "needs_work";
      // Extract issues section
      const issuesMatch = state.reviewerOutput.match(/### Issues Found[\s\S]*?(?=\n###|$)/i);
      state.reviewerIssues = issuesMatch ? issuesMatch[0].replace(/### Issues Found/i, "").trim() : "Issues found (see review)";
      state.lastFeedback = state.reviewerOutput;
      saveFlowState(cwd, state);

      if (state.iteration >= state.maxIterations) {
        state.status = "failed";
        state.completedAt = Date.now();
        saveFlowState(cwd, state);
        return state;
      }

      // Next iteration: implementer re-does with feedback
      state.status = "fixing";
      saveFlowState(cwd, state);
    }
  }

  state.status = "failed";
  state.completedAt = Date.now();
  saveFlowState(cwd, state);
  return state;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // ---- /review-flow <goal> ----
  pi.registerCommand("review-flow", {
    description: "Start an implementer/reviewer flow for a goal",
    handler: async (args: string, ctx) => {
      if (!args?.trim()) {
        ctx.ui.notify("Usage: /review-flow <goal>", "error");
        return;
      }

      const goal = args.trim();
      const maxIter = 3;

      ctx.ui.notify(`Starting review flow: "${goal}"`, "info");
      ctx.ui.setStatus("review-flow", `📋 Planning...`);

      // Run flow in background (non-blocking)
      (async () => {
        try {
          const state = await runFlow(ctx.cwd, goal, maxIter);
          if (state.status === "complete") {
            ctx.ui.notify(`Review flow complete! ✅\n${formatFlowStatus(state)}`, "success");
            ctx.ui.setStatus("review-flow", `✅ Complete`);
          } else if (state.status === "failed") {
            ctx.ui.notify(`Review flow failed: ${state.reviewerIssues}\n${formatFlowStatus(state)}`, "error");
            ctx.ui.setStatus("review-flow", `❌ Failed`);
          }
        } catch (err: any) {
          ctx.ui.notify(`Review flow error: ${err.message}`, "error");
          ctx.ui.setStatus("review-flow", `❌ Error`);
        }
      })();
    },
  });

  // ---- /review-status ----
  pi.registerCommand("review-status", {
    description: "Show current review flow status",
    handler: async (_args, ctx) => {
      const state = loadFlowState(ctx.cwd);
      if (!state) {
        ctx.ui.notify("No active review flow.", "info");
        return;
      }
      ctx.ui.notify(formatFlowStatus(state), "info");
    },
  });

  // ---- /review-approve ----
  pi.registerCommand("review-approve", {
    description: "Force-approve current review (bypass issues)",
    handler: async (_args, ctx) => {
      const state = loadFlowState(ctx.cwd);
      if (!state) {
        ctx.ui.notify("No active review flow.", "info");
        return;
      }
      if (state.status === "complete") {
        ctx.ui.notify("Flow already complete.", "info");
        return;
      }
      state.status = "complete";
      state.completedAt = Date.now();
      state.reviewerVerdict = "pass";
      state.reviewerIssues = "Force-approved by user";
      saveFlowState(ctx.cwd, state);

      ctx.ui.notify("Review flow force-approved. ✅\n" + formatFlowStatus(state), "success");
      ctx.ui.setStatus("review-flow", `✅ Approved`);
    },
  });

  // ---- /review-fix <issue> ----
  pi.registerCommand("review-fix", {
    description: "Tell implementer to fix a specific issue (resumes flow)",
    handler: async (args: string, ctx) => {
      if (!args?.trim()) {
        ctx.ui.notify("Usage: /review-fix <issue description>", "error");
        return;
      }

      const state = loadFlowState(ctx.cwd);
      if (!state) {
        ctx.ui.notify("No active review flow.", "info");
        return;
      }
      if (state.status === "complete" || state.status === "failed") {
        ctx.ui.notify("Flow already finished. Start a new one with /review-flow.", "info");
        return;
      }

      // Resume from where we left off
      const originalStatus = state.status;
      state.lastFeedback = args.trim();
      if (state.status === "reviewing") {
        // Resume: just re-run reviewer with new feedback (impl already done)
        ctx.ui.notify("Resuming review with your feedback...", "info");
        ctx.ui.setStatus("review-flow", `🔍 Re-reviewing...`);
      } else if (state.status === "fixing" || state.status === "implementing") {
        // Re-implement with new feedback
        ctx.ui.notify("Resuming implementation with your feedback...", "info");
        ctx.ui.setStatus("review-flow", `🔨 Implementing...`);
      }

      // Run remaining flow
      (async () => {
        try {
          const goal = state.goal;
          const plan = state.plan;
          const maxIter = state.maxIterations;
          let iteration = state.iteration;

          // Re-implement only if we haven't completed implementation for this cycle
          // "fixing" = impl done but reviewer found issues → re-implement
          // "implementing" = impl in progress → re-implement
          // "reviewing" = impl done, waiting for reviewer → skip impl
          if (originalStatus === "fixing" || originalStatus === "implementing") {
            // "fixing" means we already implemented this iteration but the reviewer found issues
            // We need to increment the iteration counter since we're starting a new cycle
            if (originalStatus === "fixing") iteration++;
            const implTask = buildImplementerPrompt(goal, plan, state.lastFeedback, state.implementerOutput);
            const implResult = await spawnSubagent(ctx.cwd, "implementer", implTask);
            if (implResult.exitCode !== 0) {
              throw new Error(`Implementation failed: ${implResult.stderr}`);
            }
            state.implementerOutput = getFinalOutput(implResult.messages);
            saveFlowState(ctx.cwd, state);
          }

          // Increment iteration for the upcoming review (unless we already did above)
          if (originalStatus !== "fixing" && originalStatus !== "implementing") iteration++;

          // Review
          const revTask = buildReviewerPrompt(goal, plan, state.implementerOutput || "");
          const revResult = await spawnSubagent(ctx.cwd, "reviewer", revTask);
          if (revResult.exitCode !== 0) {
            throw new Error(`Review failed: ${revResult.stderr}`);
          }
          state.reviewerOutput = getFinalOutput(revResult.messages);

          const firstLine = state.reviewerOutput.split("\n")[0] || "";
          if (firstLine.startsWith("PASS:")) {
            state.reviewerVerdict = "pass";
            state.status = "complete";
            state.completedAt = Date.now();
            state.iteration = iteration;
            saveFlowState(ctx.cwd, state);
            ctx.ui.notify(`Review passed! ✅\n${formatFlowStatus(state)}`, "success");
            ctx.ui.setStatus("review-flow", `✅ Complete`);
          } else {
            state.reviewerVerdict = "needs_work";
            const issuesMatch = state.reviewerOutput.match(/### Issues Found[\s\S]*?(?=\n###|$)/i);
            state.reviewerIssues = issuesMatch ? issuesMatch[0].replace(/### Issues Found/i, "").trim() : "Issues found";
            state.lastFeedback = state.reviewerIssues;
            state.iteration = iteration;
            saveFlowState(ctx.cwd, state);

            if (iteration >= maxIter) {
              state.status = "failed";
              state.completedAt = Date.now();
              saveFlowState(ctx.cwd, state);
              ctx.ui.notify(`Max iterations reached. ❌\n${formatFlowStatus(state)}`, "error");
              ctx.ui.setStatus("review-flow", `❌ Max iterations`);
            } else {
              state.status = "fixing";
              saveFlowState(ctx.cwd, state);
              ctx.ui.notify(`Issues found. Iteration ${iteration}/${maxIter}.`, "warning");
              ctx.ui.setStatus("review-flow", `🔧 Fixing (${iteration}/${maxIter})...`);
            }
          }
        } catch (err: any) {
          ctx.ui.notify(`Review flow error: ${err.message}`, "error");
          ctx.ui.setStatus("review-flow", `❌ Error`);
        }
      })();
    },
  });

  // ---- Session start: show residual flow status ----
  pi.on("session_start", async (event, ctx) => {
    if (event.reason === "resume" || event.reason === "startup") {
      const state = loadFlowState(ctx.cwd);
      if (state && state.status !== "complete" && state.status !== "failed") {
        ctx.ui.notify(`Resuming review flow: ${state.status} (iteration ${state.iteration}/${state.maxIterations})`, "info");
        ctx.ui.setStatus("review-flow", `${statusIcon(state.status)} ${state.status}...`);
      }
    }
  });
}
