// Tiny argv parser for NovaPlayer's dashboard and local-first utility commands.

export type CliCommand =
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "scan"; directory: string }
  | { kind: "search"; query: string }
  | { kind: "run"; initialAdd?: string }
  | { kind: "invalid"; arg: string };

export function parseCliArgs(argv: string[]): CliCommand {
  const args = argv.filter((a) => a.trim() !== "");
  if (args.length === 0) return { kind: "run" };
  if (args[0] === "scan") {
    if (args.length > 2) return { kind: "invalid", arg: args[2]! };
    return { kind: "scan", directory: args[1] ?? "~/Music" };
  }
  if (args[0] === "search") {
    if (args.length < 2) return { kind: "invalid", arg: "search" };
    return { kind: "search", query: args.slice(1).join(" ") };
  }
  if (args.length > 1) return { kind: "invalid", arg: args[1]! };
  const a = args[0]!;
  if (a === "--version" || a === "-v") return { kind: "version" };
  if (a === "--help" || a === "-h") return { kind: "help" };
  if (a.startsWith("-")) return { kind: "invalid", arg: a };
  // A link or handle: jump straight into downloading it.
  return { kind: "run", initialAdd: a };
}

export const HELP_TEXT = `NovaPlayer — terminal-first music workstation

usage
  novaplayer                open the dashboard
  novaplayer scan ~/Music   index local music incrementally
  novaplayer search <text>  fuzzy-search your local library
  novaplayer <link>         add a supported source to the download queue
  novaplayer --version      print the version

Downloads are optional. Your library and analytics stay local in
~/Music/NovaPlayer/novaplayer.db.
`;
