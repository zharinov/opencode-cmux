import { existsSync } from "node:fs";
import type { Plugin, PluginInput } from "@opencode-ai/plugin";

type Shell = PluginInput["$"];

const WORKING_STATUS = { icon: "terminal", color: "#f59e0b" } as const;

function isInCmux(): boolean {
  return (
    existsSync(process.env.CMUX_SOCKET_PATH ?? "/tmp/cmux.sock") || !!process.env.CMUX_WORKSPACE_ID
  );
}

async function cmux($: Shell, ...args: string[]): Promise<void> {
  if (!isInCmux()) {
    return;
  }

  try {
    await $`cmux ${args}`.quiet().nothrow();
  } catch {}
}

async function notify(
  $: Shell,
  opts: { title: string; subtitle?: string; body?: string },
): Promise<void> {
  const args: string[] = ["notify", "--title", opts.title];

  if (opts.subtitle !== undefined) {
    args.push("--subtitle", opts.subtitle);
  }

  if (opts.body !== undefined) {
    args.push("--body", opts.body);
  }

  await cmux($, ...args);
}

async function setStatus(
  $: Shell,
  key: string,
  text: string,
  opts?: { icon?: string; color?: string },
): Promise<void> {
  const args: string[] = ["set-status", key, text];

  if (opts?.icon !== undefined) {
    args.push("--icon", opts.icon);
  }

  if (opts?.color !== undefined) {
    args.push("--color", opts.color);
  }

  await cmux($, ...args);
}

async function clearStatus($: Shell, key: string): Promise<void> {
  await cmux($, "clear-status", key);
}

async function log(
  $: Shell,
  message: string,
  opts?: { level?: "info" | "success" | "error" | "warn"; source?: string },
): Promise<void> {
  const args: string[] = ["log"];

  if (opts?.level !== undefined) {
    const level = opts.level === "warn" ? "warning" : opts.level;
    args.push("--level", level);
  }

  if (opts?.source !== undefined) {
    args.push("--source", opts.source);
  }

  args.push("--", message);
  await cmux($, ...args);
}

const plugin: Plugin = async function ({ client, $ }) {
  const pendingPermissions = new Set<string>();
  const pendingQuestions = new Set<string>();

  function isWaitingForInput(): boolean {
    return pendingPermissions.size > 0 || pendingQuestions.size > 0;
  }

  async function setWorking(): Promise<void> {
    await setStatus($, "opencode", "working", WORKING_STATUS);
  }

  async function fetchSessionTitle(sessionID: string): Promise<string | null> {
    try {
      const result = await client.session.get({ path: { id: sessionID } });

      if (!result.data) {
        return sessionID;
      }

      if (result.data.parentID) {
        return null;
      }

      return result.data.title ?? sessionID;
    } catch {
      return sessionID;
    }
  }

  function getPermissionRequestID(source: any): string | undefined {
    if (!source) {
      return undefined;
    }

    const rawID = source.id ?? source.requestID ?? source.permissionID;
    if (typeof rawID !== "string") {
      return undefined;
    }

    const trimmed = rawID.trim();
    return trimmed === "" ? undefined : trimmed;
  }

  function getQuestionRequestID(source: any): string | undefined {
    if (!source) {
      return undefined;
    }

    const rawID = source.id ?? source.requestID;
    if (typeof rawID !== "string") {
      return undefined;
    }

    const trimmed = rawID.trim();
    return trimmed === "" ? undefined : trimmed;
  }

  async function onReply(pendingSet: Set<string>, id: string | undefined): Promise<void> {
    if (id) {
      pendingSet.delete(id);
    }

    if (!isWaitingForInput()) {
      await setWorking();
    }
  }

  async function handlePermissionAsked(properties: any): Promise<void> {
    const id = getPermissionRequestID(properties);
    if (!id || pendingPermissions.has(id)) {
      return;
    }

    pendingPermissions.add(id);

    const title = properties.title ?? properties.permission ?? "command";

    await setStatus($, "opencode", "waiting", { icon: "lock", color: "#ef4444" });
    await notify($, { title: "Needs your permission", subtitle: title });
    await log($, `Permission requested: ${title}`, { level: "info", source: "opencode" });
  }

  return {
    async event({ event }) {
      const e = event as any;

      if (e.type === "session.status") {
        const { sessionID, status } = e.properties;

        if (status.type === "busy") {
          if (!isWaitingForInput()) {
            await setWorking();
          }

          return;
        }

        if (status.type === "idle") {
          if (isWaitingForInput()) {
            return;
          }

          const title = await fetchSessionTitle(sessionID);
          if (!title) {
            return;
          }

          await notify($, { title: `Done: ${title}` });
          await log($, `Done: ${title}`, { level: "success", source: "opencode" });
          await clearStatus($, "opencode");

          return;
        }

        return;
      }

      if (e.type === "session.error") {
        pendingPermissions.clear();
        pendingQuestions.clear();

        const title = e.properties.sessionID ?? "unknown session";

        await notify($, { title: `Error: ${title}` });
        await log($, `Error in session: ${title}`, { level: "error", source: "opencode" });
        await clearStatus($, "opencode");

        return;
      }

      if (e.type === "permission.asked" || e.type === "permission.updated") {
        await handlePermissionAsked(e.properties);
        return;
      }

      if (e.type === "permission.replied") {
        await onReply(pendingPermissions, getPermissionRequestID(e.properties));
        return;
      }

      if (e.type === "question.asked") {
        const id = getQuestionRequestID(e.properties);
        if (id) {
          pendingQuestions.add(id);
        }

        const header = e.properties.questions?.[0]?.header ?? "Question";

        await setStatus($, "opencode", "question", { icon: "help-circle", color: "#a855f7" });
        await notify($, { title: "Has a question", subtitle: header });
        await log($, `Question: ${header}`, { level: "info", source: "opencode" });

        return;
      }

      if (e.type === "question.replied" || e.type === "question.rejected") {
        await onReply(pendingQuestions, getQuestionRequestID(e.properties));
        return;
      }
    },

    async "permission.ask"(input) {
      await handlePermissionAsked(input as any);
    },
  };
};

export default plugin;
