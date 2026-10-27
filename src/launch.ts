import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { call, contextCwd, listWorkspaces } from "./herdr.js";
import { expandHome, layoutTree, loadTemplates, type Template } from "./templates.js";

export interface LaunchResult {
  workspaceId: string;
  /** True if a workspace with this label was already open and got focused instead. */
  existing: boolean;
}

/** Git worktree root containing `dir`, or `dir` itself outside git. */
function worktreeRoot(dir: string): string {
  const res = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return res.status === 0 && res.stdout.trim() ? res.stdout.trim() : dir;
}

/**
 * Where and under which label `t` launches. Templates without `dir` run in the current
 * directory's worktree and get a per-worktree label, so one template serves many worktrees.
 */
export function resolveTarget(t: Template, currentDir = contextCwd()): { cwd: string; label: string } {
  if (t.dir) return { cwd: expandHome(t.dir), label: t.name };
  const cwd = worktreeRoot(currentDir);
  return { cwd, label: `${t.name}:${path.basename(cwd)}` };
}

export async function launchTemplate(t: Template): Promise<LaunchResult> {
  const { cwd, label } = resolveTarget(t);
  const open = (await listWorkspaces()).find((w) => w.label === label);
  if (open) {
    await call("workspace.focus", { workspace_id: open.workspace_id });
    return { workspaceId: open.workspace_id, existing: true };
  }

  if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`directory not found: ${cwd}`);

  const created = await call("workspace.create", { cwd, label, focus: false });
  const workspaceId: string = created.workspace.workspace_id;
  const initialTabId: string = created.tab.tab_id;
  try {
    const tabIds: string[] = [];
    for (const tab of t.tabs) {
      const res = await call("layout.apply", { workspace_id: workspaceId, tab_label: tab.name, focus: false, root: layoutTree(tab, cwd) });
      tabIds.push(res.layout.tab_id);
    }
    await call("tab.close", { tab_id: initialTabId });
    await call("workspace.focus", { workspace_id: workspaceId });
    await call("tab.focus", { tab_id: tabIds[0] });
  } catch (e) {
    // Don't leave a half-built workspace behind.
    await call("workspace.close", { workspace_id: workspaceId }).catch(() => {});
    throw e;
  }
  return { workspaceId, existing: false };
}

// `node dist/launch.js <name>` for testing outside the popup.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const name = process.argv[2];
  if (!name) {
    console.error("usage: node dist/launch.js <template name>");
    process.exit(2);
  }
  try {
    const t = loadTemplates().find((x) => x.name === name);
    if (!t) throw new Error(`no template named ${JSON.stringify(name)}`);
    const res = await launchTemplate(t);
    console.log(JSON.stringify(res));
  } catch (e) {
    console.error(`launch failed: ${(e as Error).message}`);
    process.exit(1);
  }
}
