/**
 * Derives human-readable tags and descriptions from tool call metadata.
 * Used by the conversation renderer to show meaningful labels instead of raw tool names.
 */

/** Derive a short tag from a bash command's first token */
export function bashTag(command: string): string {
  const cmd = command.trimStart();
  if (/^(cat|head|tail|less|bat)\b/.test(cmd)) return "read";
  if (/^(ls|find|tree|du)\b/.test(cmd)) return "list";
  if (/^(grep|rg|ag|ack)\b/.test(cmd)) return "search";
  if (/^(git)\b/.test(cmd)) return "git";
  if (/^(npm|yarn|pnpm|npx|pip|cargo|go)\b/.test(cmd)) return "run";
  if (/^(mkdir|cp|mv|rm|touch|chmod)\b/.test(cmd)) return "fs";
  if (/^(curl|wget|fetch)\b/.test(cmd)) return "http";
  if (/^(docker|podman)\b/.test(cmd)) return "container";
  return "shell";
}

/** Derive a tag from tool name and arguments */
export function toolTag(
  toolName: string,
  args?: Record<string, unknown>,
): string {
  switch (toolName) {
    case "bash":
      return bashTag((args?.command as string) ?? "");
    case "view":
      return "read";
    case "edit":
      return "edit";
    case "create":
      return "create";
    case "grep":
    case "glob":
      return "search";
    case "task":
      return "agent";
    case "web_search":
    case "web_fetch":
      return "web";
    case "sql":
      return "query";
    case "report_intent":
      return "intent";
    case "ask_user":
      return "question";
    default:
      if (toolName.startsWith("github-mcp-server-")) return "github";
      return "tool";
  }
}

/** Extract the best human-readable description from tool arguments */
export function toolDescription(
  toolName: string,
  args?: Record<string, unknown>,
): string {
  if (!args) return toolName;
  // Prefer explicit description/intent fields
  const desc =
    (args.description as string) ??
    (args.intent as string) ??
    undefined;
  if (desc) return desc;

  // Fallback per tool type
  switch (toolName) {
    case "bash":
      return (args.command as string) ?? "shell command";
    case "view":
    case "edit":
    case "create":
      return (args.path as string) ?? toolName;
    case "grep":
    case "glob":
      return (args.pattern as string) ?? "search";
    case "web_search":
    case "web_fetch":
      return (args.query as string) ?? (args.url as string) ?? "web";
    case "sql":
      return (args.description as string) ?? "query";
    case "task":
      return (args.description as string) ?? (args.name as string) ?? "agent task";
    case "ask_user":
      return (args.question as string) ?? "question";
    default:
      if (toolName.startsWith("github-mcp-server-")) {
        const method = toolName.replace("github-mcp-server-", "");
        return method.replace(/_/g, " ");
      }
      return toolName;
  }
}

/** Extract the detail line (raw arg) for a tool call — shown dimmed/collapsed */
export function toolDetail(
  toolName: string,
  args?: Record<string, unknown>,
): string | undefined {
  if (!args) return undefined;
  switch (toolName) {
    case "bash":
      return args.command as string | undefined;
    case "view":
    case "edit":
    case "create":
      return args.path as string | undefined;
    case "grep":
      return args.pattern as string | undefined;
    case "glob":
      return args.pattern as string | undefined;
    case "web_search":
      return args.query as string | undefined;
    case "web_fetch":
      return args.url as string | undefined;
    case "sql":
      return args.query as string | undefined;
    case "task":
      return args.prompt as string | undefined;
    case "ask_user":
      return args.question as string | undefined;
    default:
      return undefined;
  }
}
