import net from "node:net";

// Thin client for Herdr's socket API: newline-delimited JSON, one request per connection.

export class HerdrError extends Error {
  constructor(
    readonly method: string,
    readonly code: string | number | undefined,
    message: string,
  ) {
    super(`${method}: ${message}`);
  }
}

let nextId = 0;

export function call<T = any>(method: string, params: object = {}): Promise<T> {
  const socketPath = process.env.HERDR_SOCKET_PATH;
  if (!socketPath) return Promise.reject(new Error("HERDR_SOCKET_PATH is not set (not running inside Herdr?)"));

  const id = `wl-${process.pid}-${++nextId}`;
  return new Promise<T>((resolve, reject) => {
    const sock = net.createConnection(socketPath);
    let buf = "";
    let done = false;
    const finish = (err: Error | null, value?: T) => {
      if (done) return;
      done = true;
      sock.destroy();
      if (err) reject(err);
      else resolve(value as T);
    };

    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(JSON.stringify({ id, method, params }) + "\n"));
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      let msg: any;
      try {
        msg = JSON.parse(buf.slice(0, nl));
      } catch (e) {
        finish(new HerdrError(method, undefined, `bad response: ${(e as Error).message}`));
        return;
      }
      if (msg.error) finish(new HerdrError(method, msg.error.code, msg.error.message ?? JSON.stringify(msg.error)));
      else finish(null, msg.result as T);
    });
    sock.on("error", (e) => finish(e));
    sock.on("close", () => finish(new HerdrError(method, undefined, "connection closed without a response")));
  });
}

export interface PluginContext {
  workspace_id?: string;
  workspace_label?: string;
  workspace_cwd?: string;
  tab_id?: string;
  focused_pane_id?: string;
  focused_pane_cwd?: string;
}

export function context(): PluginContext {
  const raw = process.env.HERDR_PLUGIN_CONTEXT_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Directory of the pane the plugin was opened from (cwd of the process when run outside Herdr). */
export function contextCwd(): string {
  const ctx = context();
  return ctx.focused_pane_cwd || ctx.workspace_cwd || process.cwd();
}

export interface WorkspaceInfo {
  workspace_id: string;
  label: string;
  focused: boolean;
}

export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  const res = await call<{ workspaces: WorkspaceInfo[] }>("workspace.list");
  return res.workspaces ?? [];
}
