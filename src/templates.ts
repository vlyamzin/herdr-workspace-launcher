import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "smol-toml";

// ---------- types ----------

export type PresetName = "single" | "columns" | "rows" | "main-left" | "main-top" | "grid";

export interface PaneSpec {
  command?: string;
  label?: string;
}

export interface TabSpec {
  name: string;
  preset: PresetName;
  sizes?: number[];
  panes: PaneSpec[];
}

export interface Template {
  name: string;
  /** Absent = launch in the current pane's directory (its git worktree root). */
  dir?: string;
  tabs: TabSpec[];
}

// ---------- presets ----------

export interface Preset {
  name: PresetName;
  description: string;
  minPanes: number;
  maxPanes: number;
  defaultPanes: number;
  sizesHelp: string;
  /** Sizes used when `sizes` is absent. */
  defaultSizes: number[];
  slotNames(count: number): string[];
}

const numbered = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix} #${i + 1}`);

export const PRESETS: Preset[] = [
  {
    name: "single",
    description: "One pane",
    minPanes: 1,
    maxPanes: 1,
    defaultPanes: 1,
    sizesHelp: "none",
    defaultSizes: [],
    slotNames: () => ["main"],
  },
  {
    name: "columns",
    description: "2-6 panes side by side",
    minPanes: 2,
    maxPanes: 6,
    defaultPanes: 2,
    sizesHelp: "optional % per pane, e.g. 50,25,25; blank = equal",
    defaultSizes: [],
    slotNames: (n) => numbered("column", n),
  },
  {
    name: "rows",
    description: "2-6 panes stacked",
    minPanes: 2,
    maxPanes: 6,
    defaultPanes: 2,
    sizesHelp: "optional % per pane, e.g. 50,25,25; blank = equal",
    defaultSizes: [],
    slotNames: (n) => numbered("row", n),
  },
  {
    name: "main-left",
    description: "Big pane left + 1-5 stacked right",
    minPanes: 2,
    maxPanes: 6,
    defaultPanes: 3,
    sizesHelp: "[main %], default 60",
    defaultSizes: [60],
    slotNames: (n) => ["main (left)", ...numbered("right stack", n - 1)],
  },
  {
    name: "main-top",
    description: "Big pane top + 1-5 side by side below",
    minPanes: 2,
    maxPanes: 6,
    defaultPanes: 3,
    sizesHelp: "[main %], default 60",
    defaultSizes: [60],
    slotNames: (n) => ["main (top)", ...numbered("bottom row", n - 1)],
  },
  {
    name: "grid",
    description: "4 panes in a 2x2 grid",
    minPanes: 4,
    maxPanes: 4,
    defaultPanes: 4,
    sizesHelp: "[left column %, top row %], default 50/50",
    defaultSizes: [50, 50],
    slotNames: () => ["top-left", "top-right", "bottom-left", "bottom-right"],
  },
];

export function preset(name: string): Preset | undefined {
  return PRESETS.find((p) => p.name === name);
}

/** Returns an error message, or undefined if `sizes` is valid for this preset and pane count. */
export function checkSizes(p: Preset, count: number, sizes: number[] | undefined): string | undefined {
  if (!sizes || sizes.length === 0) return undefined;
  if (sizes.some((s) => !Number.isFinite(s) || s <= 0)) return "sizes must be positive numbers";
  switch (p.name) {
    case "single":
      return "the single preset takes no sizes";
    case "columns":
    case "rows":
      return sizes.length === count ? undefined : `expected ${count} sizes (one per pane), got ${sizes.length}`;
    case "main-left":
    case "main-top":
      if (sizes.length !== 1) return "expected one size: [main %]";
      return sizes[0] >= 5 && sizes[0] <= 95 ? undefined : "main % must be between 5 and 95";
    case "grid":
      if (sizes.length !== 2) return "expected two sizes: [left column %, top row %]";
      return sizes.every((s) => s >= 5 && s <= 95) ? undefined : "grid sizes must be between 5 and 95";
  }
}

// ---------- layout shapes ----------

/** Preset-independent split tree; leaves are pane indexes into TabSpec.panes. */
export type Shape =
  | { kind: "leaf"; slot: number }
  | { kind: "split"; direction: "right" | "down"; ratio: number; first: Shape; second: Shape };

const clampRatio = (r: number) => Math.min(0.95, Math.max(0.05, r));

function chain(direction: "right" | "down", slots: number[], weights: number[]): Shape {
  if (slots.length === 1) return { kind: "leaf", slot: slots[0] };
  const total = weights.reduce((a, b) => a + b, 0);
  return {
    kind: "split",
    direction,
    ratio: clampRatio(weights[0] / total),
    first: { kind: "leaf", slot: slots[0] },
    second: chain(direction, slots.slice(1), weights.slice(1)),
  };
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

export function shapeOf(tab: Pick<TabSpec, "preset" | "sizes"> & { count: number }): Shape {
  const p = preset(tab.preset)!;
  const sizes = tab.sizes && tab.sizes.length ? tab.sizes : p.defaultSizes;
  const n = tab.count;
  switch (tab.preset) {
    case "single":
      return { kind: "leaf", slot: 0 };
    case "columns":
    case "rows": {
      const weights = sizes.length === n ? sizes : Array(n).fill(1);
      return chain(tab.preset === "columns" ? "right" : "down", range(0, n), weights);
    }
    case "main-left":
    case "main-top": {
      const [main, stack] = tab.preset === "main-left" ? (["right", "down"] as const) : (["down", "right"] as const);
      return {
        kind: "split",
        direction: main,
        ratio: clampRatio(sizes[0] / 100),
        first: { kind: "leaf", slot: 0 },
        second: chain(stack, range(1, n), Array(n - 1).fill(1)),
      };
    }
    case "grid": {
      const top = clampRatio(sizes[1] / 100);
      const column = (a: number, b: number): Shape => ({
        kind: "split",
        direction: "down",
        ratio: top,
        first: { kind: "leaf", slot: a },
        second: { kind: "leaf", slot: b },
      });
      return { kind: "split", direction: "right", ratio: clampRatio(sizes[0] / 100), first: column(0, 2), second: column(1, 3) };
    }
  }
}

// ---------- Herdr layout tree ----------

export type LayoutNode =
  | { type: "pane"; label?: string; cwd?: string; command?: string[] }
  | { type: "split"; direction: "right" | "down"; ratio: number; first: LayoutNode; second: LayoutNode };

/** Single-quote a string for POSIX sh. */
export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * A pane closes when its command exits, so run the command in an interactive shell
 * (rc files + PATH) and exec a fresh shell afterwards.
 */
export function wrapCommand(command: string | undefined, shell = process.env.SHELL || "/bin/sh"): string[] | undefined {
  const cmd = command?.trim();
  if (!cmd) return undefined;
  return [shell, "-ic", `${cmd}; exec ${shQuote(shell)}`];
}

export function paneLabel(pane: PaneSpec): string | undefined {
  return pane.label?.trim() || pane.command?.trim().split(/\s+/)[0] || undefined;
}

export function layoutTree(tab: TabSpec, cwd: string): LayoutNode {
  const toNode = (s: Shape): LayoutNode => {
    if (s.kind === "split") return { type: "split", direction: s.direction, ratio: s.ratio, first: toNode(s.first), second: toNode(s.second) };
    const pane = tab.panes[s.slot] ?? {};
    const node: LayoutNode = { type: "pane", cwd };
    const label = paneLabel(pane);
    const command = wrapCommand(pane.command);
    if (label) node.label = label;
    if (command) node.command = command;
    return node;
  };
  return toNode(shapeOf({ ...tab, count: tab.panes.length }));
}

// ---------- ASCII rendering ----------

/** Draws `shape` in a width x height box; `text(slot)` gives the lines centered in each pane. */
export function renderAscii(shape: Shape, width: number, height: number, text: (slot: number) => string[]): string[] {
  const grid = Array.from({ length: height }, () => Array<string>(width).fill(" "));
  const leaves: { slot: number; x0: number; y0: number; x1: number; y1: number }[] = [];

  const split = (lo: number, hi: number, ratio: number) => {
    const mid = lo + Math.round((hi - lo) * ratio);
    return hi - lo >= 4 ? Math.min(hi - 2, Math.max(lo + 2, mid)) : mid;
  };
  const walk = (s: Shape, x0: number, y0: number, x1: number, y1: number) => {
    if (s.kind === "leaf") return void leaves.push({ slot: s.slot, x0, y0, x1, y1 });
    if (s.direction === "right") {
      const m = split(x0, x1, s.ratio);
      walk(s.first, x0, y0, m, y1);
      walk(s.second, m, y0, x1, y1);
    } else {
      const m = split(y0, y1, s.ratio);
      walk(s.first, x0, y0, x1, m);
      walk(s.second, x0, m, x1, y1);
    }
  };
  walk(shape, 0, 0, width - 1, height - 1);

  for (const r of leaves) {
    for (let x = r.x0; x <= r.x1; x++) grid[r.y0][x] = grid[r.y1][x] = "-";
    for (let y = r.y0; y <= r.y1; y++) grid[y][r.x0] = grid[y][r.x1] = "|";
  }
  for (const r of leaves) {
    for (const [x, y] of [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]]) grid[y][x] = "+";
    const innerW = r.x1 - r.x0 - 1;
    const innerH = r.y1 - r.y0 - 1;
    const lines = text(r.slot).slice(0, innerH).map((l) => (l.length > innerW ? l.slice(0, Math.max(0, innerW - 1)) + "~" : l));
    const top = r.y0 + 1 + Math.floor((innerH - lines.length) / 2);
    lines.forEach((line, i) => {
      const left = r.x0 + 1 + Math.floor((innerW - line.length) / 2);
      for (let j = 0; j < line.length; j++) grid[top + i][left + j] = line[j];
    });
  }
  return grid.map((row) => row.join(""));
}

/** Tall enough that every stacked pane gets two text lines. */
export function diagramHeight(presetName: PresetName, count: number): number {
  const stacked = presetName === "rows" ? count : presetName === "main-left" ? count - 1 : 2;
  return Math.max(9, Math.min(19, stacked * 3 + 1));
}

export function describeSizes(tab: Pick<TabSpec, "preset" | "sizes">): string {
  const p = preset(tab.preset)!;
  const sizes = tab.sizes && tab.sizes.length ? tab.sizes : p.defaultSizes;
  switch (tab.preset) {
    case "single":
      return "";
    case "columns":
    case "rows":
      return sizes.length ? sizes.join("/") : "equal";
    case "main-left":
    case "main-top":
      return `main ${sizes[0]}%`;
    case "grid":
      return `left ${sizes[0]}% / top ${sizes[1]}%`;
  }
}

/** Human-readable template description, used by the fzf preview and the wizard summary. */
export function describeTemplate(t: Template, width = 60): string {
  const out = [`name: ${t.name}`, `dir:  ${t.dir ?? CURRENT_DIR}`, ""];
  const boxW = Math.max(20, Math.min(width - 2, 64));
  t.tabs.forEach((tab, i) => {
    const sizes = describeSizes(tab);
    out.push(`[${i + 1}] ${tab.name} · ${tab.preset}${sizes ? ` (${sizes})` : ""}`);
    const shape = shapeOf({ ...tab, count: tab.panes.length });
    out.push(...renderAscii(shape, boxW, diagramHeight(tab.preset, tab.panes.length), (s) => [String(s + 1), paneLabel(tab.panes[s] ?? {}) ?? "shell"]).map((l) => "  " + l));
    const names = preset(tab.preset)!.slotNames(tab.panes.length);
    const nameW = Math.max(...names.map((n) => n.length));
    tab.panes.forEach((pane, s) => {
      out.push(`  ${s + 1} ${names[s].padEnd(nameW)}  ${pane.command?.trim() || "(shell)"}`);
    });
    out.push("");
  });
  return out.join("\n");
}

// ---------- paths ----------

export const CURRENT_DIR = "(current directory)";

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function contractHome(p: string): string {
  const home = os.homedir();
  if (p === home) return "~";
  if (p.startsWith(home + path.sep)) return "~" + p.slice(home.length);
  return p;
}

export function templatesPath(): string {
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR;
  if (!dir) throw new Error("HERDR_PLUGIN_CONFIG_DIR is not set (not running as a Herdr plugin?)");
  return path.join(dir, "templates.toml");
}

// ---------- load / save ----------

export class TemplateFileError extends Error {}

function fromToml(doc: Record<string, unknown>): Template[] {
  const fail = (where: string, msg: string): never => {
    throw new TemplateFileError(`${where}: ${msg}`);
  };
  const raw = doc.template ?? [];
  if (!Array.isArray(raw)) fail("template", "must be an array of tables ([[template]])");
  const seen = new Set<string>();

  return (raw as any[]).map((t, ti) => {
    let where = `template #${ti + 1}`;
    if (typeof t?.name !== "string" || !t.name.trim()) fail(where, "missing name");
    where = `template "${t.name}"`;
    if (seen.has(t.name)) fail(where, "duplicate name");
    seen.add(t.name);
    if (t.dir !== undefined && (typeof t.dir !== "string" || !t.dir.trim())) fail(where, "dir must be a non-empty string (omit it to use the current directory)");
    if (!Array.isArray(t.tab) || t.tab.length === 0) fail(where, "needs at least one [[template.tab]]");

    const tabs = (t.tab as any[]).map((tab, i): TabSpec => {
      const tw = `${where}, tab #${i + 1}`;
      if (typeof tab?.name !== "string" || !tab.name.trim()) fail(tw, "missing name");
      const p = preset(tab.preset);
      if (!p) fail(tw, `unknown preset ${JSON.stringify(tab.preset)} (expected one of ${PRESETS.map((x) => x.name).join(", ")})`);
      const panesRaw = tab.pane ?? Array.from({ length: p!.minPanes }, () => ({}));
      if (!Array.isArray(panesRaw)) fail(tw, "pane must be an array of tables ([[template.tab.pane]])");
      if (panesRaw.length < p!.minPanes || panesRaw.length > p!.maxPanes) {
        const want = p!.minPanes === p!.maxPanes ? `${p!.minPanes}` : `${p!.minPanes}-${p!.maxPanes}`;
        fail(tw, `preset ${p!.name} takes ${want} panes, got ${panesRaw.length}`);
      }
      const panes = (panesRaw as any[]).map((pane, j): PaneSpec => {
        for (const key of ["command", "label"] as const) {
          if (pane?.[key] !== undefined && typeof pane[key] !== "string") fail(`${tw}, pane #${j + 1}`, `${key} must be a string`);
        }
        return { ...(pane.command !== undefined && { command: pane.command }), ...(pane.label !== undefined && { label: pane.label }) };
      });
      let sizes: number[] | undefined;
      if (tab.sizes !== undefined) {
        if (!Array.isArray(tab.sizes) || tab.sizes.some((s: unknown) => typeof s !== "number")) fail(tw, "sizes must be an array of numbers");
        sizes = tab.sizes.map(Number);
        const err = checkSizes(p!, panes.length, sizes);
        if (err) fail(tw, err);
      }
      return { name: tab.name, preset: p!.name, ...(sizes && { sizes }), panes };
    });
    return { name: t.name, ...(t.dir !== undefined && { dir: t.dir }), tabs };
  });
}

function toToml(templates: Template[]): Record<string, unknown> {
  return {
    template: templates.map((t) => ({
      name: t.name,
      ...(t.dir && { dir: t.dir }),
      tab: t.tabs.map((tab) => ({
        name: tab.name,
        preset: tab.preset,
        ...(tab.sizes && tab.sizes.length && { sizes: tab.sizes }),
        pane: tab.panes.map((p) => ({
          ...(p.command?.trim() && { command: p.command }),
          ...(p.label && { label: p.label }),
        })),
      })),
    })),
  };
}

export function loadTemplates(file = templatesPath()): Template[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  let doc: Record<string, unknown>;
  try {
    doc = parse(text);
  } catch (e) {
    throw new TemplateFileError((e as Error).message);
  }
  return fromToml(doc);
}

export function saveTemplates(templates: Template[], file = templatesPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, stringify(toToml(templates)) + "\n");
  fs.renameSync(tmp, file);
}
