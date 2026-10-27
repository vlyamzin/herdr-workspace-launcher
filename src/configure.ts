import fs from "node:fs";
import { contextCwd } from "./herdr.js";
import {
  PRESETS,
  checkSizes,
  contractHome,
  describeTemplate,
  diagramHeight,
  expandHome,
  preset,
  renderAscii,
  shapeOf,
  type PaneSpec,
  type Preset,
  type PresetName,
  type TabSpec,
  type Template,
} from "./templates.js";
import { Cancelled, ask, askNumber, bold, clearScreen, confirm, dim, fzf, previewCommand } from "./ui.js";

export interface WizardResult {
  template: Template;
  /** User asked to launch right after saving (new templates only). */
  launch: boolean;
}

const required = (v: string) => (v ? undefined : "required");
const isDir = (p: string) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;


/**
 * Create (`existing` undefined) or edit a template. Every prompt is prefilled so Enter keeps
 * the current value. Returns null if the user declines to save; throws Cancelled on Esc/Ctrl-C.
 */
export async function runWizard(all: Template[], existing?: Template, nameHint = ""): Promise<WizardResult | null> {
  clearScreen();
  console.log(bold(existing ? `Edit template "${existing.name}"` : "New template") + dim("   Esc / Ctrl-C cancels\n"));

  const name = await ask("Template name:", {
    initial: existing?.name ?? nameHint,
    validate: (v) => required(v) ?? (all.some((t) => t !== existing && t.name === v) ? `a template named "${v}" already exists` : undefined),
  });
  console.log(dim("Blank directory = launch wherever the popup is opened (that git worktree's root)."));
  const dir = await ask("Directory:", {
    initial: existing ? (existing.dir ?? "") : contractHome(contextCwd()),
    validate: (v) => (!v || isDir(expandHome(v)) ? undefined : `not a directory: ${expandHome(v)}`),
  });
  const tabCount = await askNumber("Number of tabs", { min: 1, max: 9, initial: existing?.tabs.length ?? 1 });

  const tabs: TabSpec[] = [];
  for (let i = 0; i < tabCount; i++) tabs.push(await askTab(i, tabCount, existing?.tabs[i]));

  const template: Template = { name, ...(dir && { dir }), tabs };
  clearScreen();
  console.log(bold("Summary\n"));
  console.log(describeTemplate(template, process.stdout.columns ?? 80));
  if (!(await confirm("Save?", true))) return null;
  const launch = !existing && (await confirm("Launch now?", true));
  return { template, launch };
}

async function askTab(index: number, total: number, prev: TabSpec | undefined): Promise<TabSpec> {
  console.log("\n" + bold(`Tab ${index + 1}/${total}`));
  const name = await ask("  Tab name:", { initial: prev?.name ?? (index === 0 ? "main" : `tab${index + 1}`), validate: required });

  const p = preset(await pickPreset(prev?.preset))!;
  console.log(`  ${bold("Layout:")} ${p.name} ${dim(`- ${p.description}`)}`);
  // Only carry over pane count and sizes when the preset is unchanged; commands carry over by index.
  const same = prev?.preset === p.name ? prev : undefined;

  const count =
    p.minPanes === p.maxPanes
      ? p.minPanes
      : await askNumber("  Panes", { min: p.minPanes, max: p.maxPanes, initial: same?.panes.length ?? p.defaultPanes });
  const sizes = await askSizes(p, count, same?.sizes);

  const names = p.slotNames(count);
  const width = Math.max(30, Math.min((process.stdout.columns ?? 80) - 4, 60));
  console.log();
  for (const line of renderAscii(shapeOf({ preset: p.name, sizes, count }), width, diagramHeight(p.name, count), (s) => [String(s + 1), names[s]])) {
    console.log("  " + line);
  }
  console.log(dim("  Command per pane; blank = plain shell."));

  const panes: PaneSpec[] = [];
  for (let s = 0; s < count; s++) {
    const prevPane = prev?.panes[s];
    const command = await ask(`  ${s + 1} ${names[s]}:`, { initial: prevPane?.command ?? "" });
    panes.push({ ...(command && { command }), ...(prevPane?.label && { label: prevPane.label }) });
  }
  return { name, preset: p.name, ...(sizes && { sizes }), panes };
}

async function pickPreset(current: PresetName | undefined): Promise<PresetName> {
  // Current preset first so Enter keeps it.
  const ordered = [...PRESETS].sort((a, b) => Number(b.name === current) - Number(a.name === current));
  const res = await fzf(
    ordered.map((p) => `${p.name}\t${p.name.padEnd(10)} ${p.description}`),
    [
      "--layout=reverse",
      "--height=~60%",
      "--border=rounded",
      "--border-label= Layout preset ",
      "--delimiter=\t",
      "--with-nth=2..",
      "--no-sort",
      `--preview=${previewCommand("--preview-preset {1}")}`,
      "--preview-window=right,60%",
    ],
  );
  if (!res?.selection) throw new Cancelled();
  return res.selection.split("\t")[0] as PresetName;
}

/** Sizes as stored in the template, or undefined for the preset default. */
async function askSizes(p: Preset, count: number, prev: number[] | undefined): Promise<number[] | undefined> {
  const percent = (v: string) => (/^\d+(\.\d+)?$/.test(v) && Number(v) >= 5 && Number(v) <= 95 ? undefined : "enter a number from 5 to 95");
  // Keep "use the default" implicit unless the template already pinned explicit sizes.
  const result = (values: number[]) => (!prev && values.every((v, i) => v === p.defaultSizes[i]) ? undefined : values);

  switch (p.name) {
    case "single":
      return undefined;
    case "columns":
    case "rows": {
      const v = await ask(`  Sizes in % per pane, e.g. ${count === 3 ? "50,25,25" : "60,40"} (blank = equal):`, {
        initial: prev && prev.length === count ? prev.join(",") : "",
        validate: (v) => (v ? checkSizes(p, count, v.split(",").map((x) => Number(x.trim()))) : undefined),
      });
      return v ? v.split(",").map((x) => Number(x.trim())) : undefined;
    }
    case "main-left":
    case "main-top": {
      const main = await ask("  Main pane size %:", { initial: String(prev?.[0] ?? p.defaultSizes[0]), validate: percent });
      return result([Number(main)]);
    }
    case "grid": {
      const left = await ask("  Left column %:", { initial: String(prev?.[0] ?? p.defaultSizes[0]), validate: percent });
      const top = await ask("  Top row %:", { initial: String(prev?.[1] ?? p.defaultSizes[1]), validate: percent });
      return result([Number(left), Number(top)]);
    }
  }
}
