import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { shQuote } from "./templates.js";

export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
export const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

export function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

/** Thrown by prompts when the user presses Esc / Ctrl-C / Ctrl-D. */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

// ---------- fzf ----------

export interface FzfResult {
  query: string;
  /** The --expect key that ended fzf, or "" for Enter. */
  key: string;
  selection?: string;
}

/** fzf --preview command that re-enters picker.js in preview mode, e.g. previewCommand("--preview-preset {1}"). */
export function previewCommand(args: string): string {
  const picker = fileURLToPath(new URL("./picker.js", import.meta.url));
  return `${shQuote(process.execPath)} ${shQuote(picker)} ${args}`;
}

/** Runs fzf over `items`. Returns null when the user cancels (Esc / Ctrl-C). */
export function fzf(items: string[], args: string[], expect: string[] = []): Promise<FzfResult | null> {
  const argv = [...args, "--print-query", "--bind=enter:accept-non-empty"];
  if (expect.length) argv.push(`--expect=${expect.join(",")}`);

  return new Promise((resolve, reject) => {
    const child = spawn("fzf", argv, { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (out += d));
    child.stdin.on("error", () => {}); // fzf may exit before reading everything
    child.on("error", (e) =>
      reject((e as NodeJS.ErrnoException).code === "ENOENT" ? new Error("fzf not found on PATH; install fzf first") : e),
    );
    child.on("close", (code) => {
      if (code === 130) return resolve(null);
      if (code !== 0 && code !== 1) return reject(new Error(`fzf exited with code ${code}`));
      const lines = out.replace(/\n$/, "").split("\n");
      const query = lines.shift() ?? "";
      const key = expect.length ? (lines.shift() ?? "") : "";
      resolve({ query, key, selection: lines[0] || undefined });
    });
    child.stdin.end(items.join("\n"));
  });
}

// ---------- line prompts ----------

/** One readline per prompt so fzf and editors get the terminal to themselves in between. */
async function readLine(prompt: string, initial: string): Promise<string> {
  const ac = new AbortController();
  const abort = () => ac.abort();
  const onKey = (_s: string | undefined, key: { name?: string } | undefined) => {
    if (key?.name === "escape") ac.abort();
  };
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", abort);
  rl.on("close", abort); // Ctrl-D
  process.stdin.on("keypress", onKey);
  try {
    const answer = rl.question(prompt, { signal: ac.signal });
    if (initial) rl.write(initial);
    return await answer;
  } catch (e) {
    if (ac.signal.aborted) {
      process.stdout.write("\n");
      throw new Cancelled();
    }
    throw e;
  } finally {
    process.stdin.off("keypress", onKey);
    rl.off("close", abort);
    rl.close();
  }
}

export interface AskOptions {
  /** Prefilled, editable value; Enter keeps it. */
  initial?: string;
  /** Returns an error message to re-ask, or undefined if the (trimmed) value is fine. */
  validate?: (value: string) => string | undefined;
}

export async function ask(question: string, opts: AskOptions = {}): Promise<string> {
  let initial = opts.initial ?? "";
  for (;;) {
    const raw = await readLine(`${bold(question)} `, initial);
    const value = raw.trim();
    const err = opts.validate?.(value);
    if (!err) return value;
    console.log(red(`  ${err}`));
    initial = raw;
  }
}

export async function askNumber(question: string, opts: { min: number; max: number; initial?: number }): Promise<number> {
  const value = await ask(`${question} (${opts.min}-${opts.max}):`, {
    initial: opts.initial !== undefined ? String(opts.initial) : "",
    validate: (v) => {
      const n = Number(v);
      return /^\d+$/.test(v) && n >= opts.min && n <= opts.max ? undefined : `enter a whole number from ${opts.min} to ${opts.max}`;
    },
  });
  return Number(value);
}

export async function confirm(question: string, defaultYes: boolean): Promise<boolean> {
  const value = await ask(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"}`, {
    validate: (v) => (/^(y|yes|n|no|)$/i.test(v) ? undefined : "answer y or n"),
  });
  return value === "" ? defaultYes : /^y/i.test(value);
}

/** Waits for Enter (or Esc). */
export async function pause(message = "Press Enter to continue"): Promise<void> {
  try {
    await readLine(dim(message), "");
  } catch (e) {
    if (!(e instanceof Cancelled)) throw e;
  }
}

// ---------- editor ----------

export function openInEditor(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, "");
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  // Through sh so EDITOR may carry arguments (e.g. "code --wait").
  spawnSync("sh", ["-c", `${editor} "$1"`, "sh", file], { stdio: "inherit" });
}
