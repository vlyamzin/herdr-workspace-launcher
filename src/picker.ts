import { runWizard } from "./configure.js";
import { launchTemplate } from "./launch.js";
import {
  CURRENT_DIR,
  describeSizes,
  describeTemplate,
  diagramHeight,
  loadTemplates,
  preset,
  renderAscii,
  saveTemplates,
  shapeOf,
  templatesPath,
  type Template,
} from "./templates.js";
import { Cancelled, bold, clearScreen, confirm, dim, fzf, green, openInEditor, pause, previewCommand, red } from "./ui.js";

const NEW = "new";
const KEYS = ["ctrl-n", "ctrl-e", "ctrl-d", "ctrl-o"];
const HEADER = "enter launch · ^N new · ^E edit · ^D delete · ^O edit file · esc close";

// ---------- fzf preview mode (picker.js re-invoked by fzf) ----------

function preview(kind: string, arg: string): void {
  const width = Number(process.env.FZF_PREVIEW_COLUMNS) || 60;
  if (kind === "--preview-template") {
    if (arg === NEW) {
      console.log(bold("+ New template\n"));
      console.log("Start the wizard to create a workspace template:\na name, a directory, and tabs with split layouts.\n");
      console.log(dim(HEADER.split(" · ").join("\n")));
      return;
    }
    const t = loadTemplates()[Number(arg)];
    if (t) console.log(describeTemplate(t, width));
    return;
  }
  const p = preset(arg);
  if (!p) return;
  const count = p.defaultPanes;
  const names = p.slotNames(count);
  console.log(bold(p.name) + "  " + p.description);
  console.log(`panes: ${p.minPanes === p.maxPanes ? p.minPanes : `${p.minPanes}-${p.maxPanes}`}`);
  console.log(`sizes: ${p.sizesHelp}\n`);
  const shape = shapeOf({ preset: p.name, count });
  for (const line of renderAscii(shape, Math.max(20, Math.min(width - 2, 50)), diagramHeight(p.name, count), (s) => [String(s + 1), names[s]])) {
    console.log(line);
  }
  if (describeSizes({ preset: p.name })) console.log(dim(`\ndefault: ${describeSizes({ preset: p.name })}`));
}

// ---------- interactive picker ----------

function listItems(templates: Template[]): string[] {
  const w = Math.max(0, ...templates.map((t) => t.name.length));
  return [
    ...templates.map((t, i) => `${i}\t${t.name.padEnd(w)}\t${dim(`${t.dir ?? CURRENT_DIR} · ${t.tabs.map((x) => x.name).join(", ")}`)}`),
    `${NEW}\t${green("+ New template")}`,
  ];
}

/** Returns true if the popup should close (a template was launched). */
async function wizard(file: string, templates: Template[], existing?: Template, nameHint?: string): Promise<boolean> {
  const res = await runWizard(templates, existing, nameHint);
  if (!res) return false;
  saveTemplates(existing ? templates.map((t) => (t === existing ? res.template : t)) : [...templates, res.template], file);
  return res.launch && (await launch(res.template));
}

async function launch(t: Template): Promise<boolean> {
  clearScreen();
  console.log(`Launching ${bold(t.name)}…`);
  const res = await launchTemplate(t);
  if (res.existing) console.log("Already open; focused it.");
  return true;
}

async function main(): Promise<void> {
  const file = templatesPath();
  for (;;) {
    let templates: Template[];
    try {
      templates = loadTemplates(file);
    } catch (e) {
      clearScreen();
      console.log(red(bold("Could not read templates file")));
      console.log(dim(file) + "\n");
      console.log((e as Error).message + "\n");
      let edit = false;
      try {
        edit = await confirm("Open it in your editor?", true);
      } catch (err) {
        if (!(err instanceof Cancelled)) throw err;
      }
      if (!edit) return;
      openInEditor(file);
      continue;
    }

    const res = await fzf(
      listItems(templates),
      [
        "--ansi",
        "--layout=reverse",
        "--border=rounded",
        "--border-label= Workspace templates ",
        "--prompt=workspace> ",
        `--header=${HEADER}`,
        "--delimiter=\t",
        "--with-nth=2..",
        "--nth=1", // search template names only, not dirs
        "--no-sort",
        `--preview=${previewCommand("--preview-template {1}")}`,
        "--preview-window=right,55%",
      ],
      KEYS,
    );
    if (!res) return; // Esc

    const id = res.selection?.split("\t")[0];
    const selected = id !== undefined && id !== NEW ? templates[Number(id)] : undefined;
    try {
      switch (res.key) {
        case "ctrl-n":
          if (await wizard(file, templates, undefined, res.query.trim())) return;
          break;
        case "ctrl-e":
          if (await wizard(file, templates, selected)) return;
          break;
        case "ctrl-d":
          if (selected && (await confirm(`Delete template "${selected.name}"?`, false))) {
            saveTemplates(templates.filter((t) => t !== selected), file);
          }
          break;
        case "ctrl-o":
          openInEditor(file);
          break;
        default:
          if (id === NEW) {
            if (await wizard(file, templates)) return;
          } else if (selected && (await launch(selected))) {
            return;
          }
      }
    } catch (e) {
      if (e instanceof Cancelled) continue;
      console.log(red(`\nError: ${(e as Error).message}`));
      await pause();
    }
  }
}

const [mode, arg] = process.argv.slice(2);
try {
  if (mode?.startsWith("--preview-")) preview(mode, arg ?? "");
  else await main();
  process.exit(0);
} catch (e) {
  console.error(red(`workspace-launcher: ${(e as Error).message}`));
  await pause().catch(() => {});
  process.exit(1);
}
