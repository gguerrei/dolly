import type { Command } from "commander";

/**
 * Completion scripts for zsh, bash, and fish, rendered from the command
 * tree itself so they cannot drift from it. Pattern names complete live
 * from \`dolly list\`, so a pattern completes the moment it is saved, and
 * directory arguments complete as directories.
 */
export const SHELLS = ["zsh", "bash", "fish"] as const;
export type Shell = (typeof SHELLS)[number];

interface Flag {
  short?: string;
  long: string;
  description: string;
  takesValue: boolean;
}

interface Verb {
  name: string;
  description: string;
  flags: Flag[];
  /** The first positional is a pattern name. */
  patternFirst: boolean;
  /** Some positional is a path. */
  paths: boolean;
  subcommands: Verb[];
}

function verbsOf(command: Command): Verb[] {
  return command.commands
    .filter((c) => c.name() !== "help")
    .map((c) => ({
      name: c.name(),
      description: c.description(),
      flags: c.options
        .filter((o) => o.long !== undefined)
        .map((o) => ({
          ...(o.short ? { short: o.short } : {}),
          long: o.long as string,
          description: o.description,
          takesValue: Boolean(o.required || o.optional),
        })),
      patternFirst: /^(pattern|name)$/.test(c.registeredArguments[0]?.name() ?? ""),
      paths: c.registeredArguments.some((a) => /^(paths?|dir|file|source)$/.test(a.name())),
      subcommands: verbsOf(c),
    }));
}

export function renderCompletions(program: Command, shell: Shell): string {
  const verbs = verbsOf(program);
  return { zsh: zsh(verbs), bash: bash(verbs), fish: fish(verbs) }[shell];
}

/** One line: the names of the saved patterns, for a live completion. */
const PATTERN_NAMES = "dolly list 2>/dev/null | awk '{print $1}'";

const q = (text: string) => `'${text.replace(/'/g, "'\\\\''")}'`;

function zsh(verbs: Verb[]): string {
  const spec = (verb: Verb): string[] => {
    const args = verb.flags.flatMap((flag) => {
      const value = flag.takesValue
        ? `:value:${/dir|path/.test(flag.long) ? "_files -/" : ""}`
        : "";
      const desc = flag.description.replace(/[\\[\\]]/g, "");
      return [
        `${flag.long}[${desc}]${value}`,
        ...(flag.short ? [`${flag.short}[${desc}]${value}`] : []),
      ];
    });
    if (verb.patternFirst) args.push("1:pattern:_dolly_patterns");
    if (verb.paths) args.push(`${verb.patternFirst ? "2" : "*"}:path:_files -/`);
    if (verb.subcommands.length > 0) args.push("1:subcommand:_dolly_subcommand");
    return args;
  };
  const cases = verbs
    .map((verb) => {
      if (verb.subcommands.length === 0) {
        return `    ${verb.name}) _arguments ${spec(verb).map(q).join(" ")} ;;`;
      }
      const inner = verb.subcommands
        .map(
          (sub) =>
            `        ${sub.name}) _arguments ${spec(sub).map(q).join(" ") || "'*::arg:'"} ;;`,
        )
        .join("\\n");
      const names = verb.subcommands
        .map((s) => q(`${s.name}:${s.description.replace(/:/g, " ")}`))
        .join(" ");
      return `    ${verb.name})
      local -a subcommands
      subcommands=(${names})
      _dolly_subcommand() { _describe 'subcommand' subcommands }
      case $words[2] in
${inner}
        *) _arguments '1:subcommand:_dolly_subcommand' ;;
      esac ;;`;
    })
    .join("\\n");
  const commands = verbs.map((v) => q(`${v.name}:${v.description.replace(/:/g, " ")}`)).join(" ");
  return `#compdef dolly
# dolly completions for zsh. Install with:
#   dolly completions zsh > "\${fpath[1]}/_dolly" && compinit

_dolly_patterns() {
  local -a names
  names=(\${(f)"$(${PATTERN_NAMES})"})
  _describe 'pattern' names
}

_dolly() {
  local -a commands
  commands=(${commands})
  _arguments -C '1: :->command' '*::arg:->args'
  case $state in
    command) _describe 'command' commands ;;
    args)
      case $words[1] in
${cases}
      esac ;;
  esac
}

_dolly "$@"
`;
}

function bash(verbs: Verb[]): string {
  const patternVerbs = verbs.filter((v) => v.patternFirst).map((v) => v.name);
  const flagsOf = (verb: Verb) =>
    verb.flags.flatMap((f) => [f.long, ...(f.short ? [f.short] : [])]).join(" ");
  const cases = verbs
    .map((verb) => {
      if (verb.subcommands.length === 0) return `    ${verb.name}) flags="${flagsOf(verb)}" ;;`;
      const inner = verb.subcommands.map((s) => `${s.name}) flags="${flagsOf(s)}" ;;`).join(" ");
      return `    ${verb.name})
      if [ "$COMP_CWORD" -eq 2 ]; then COMPREPLY=($(compgen -W "${verb.subcommands.map((s) => s.name).join(" ")}" -- "$cur")); return; fi
      case "\${COMP_WORDS[2]}" in ${inner} esac ;;`;
    })
    .join("\\n");
  return `# dolly completions for bash. Install with:
#   dolly completions bash > ~/.local/share/bash-completion/completions/dolly

_dolly() {
  local cur cmd flags
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cmd="\${COMP_WORDS[1]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=($(compgen -W "${verbs.map((v) => v.name).join(" ")}" -- "$cur"))
    return
  fi
  case "$cmd" in
    ${patternVerbs.join("|")})
      if [ "$COMP_CWORD" -eq 2 ] && [[ "$cur" != -* ]]; then
        COMPREPLY=($(compgen -W "$(${PATTERN_NAMES})" -- "$cur"))
        return
      fi ;;
  esac
  flags=""
  case "$cmd" in
${cases}
  esac
  if [[ "$cur" == -* ]]; then
    COMPREPLY=($(compgen -W "$flags" -- "$cur"))
  else
    compopt -o default 2>/dev/null
    COMPREPLY=()
  fi
}

complete -F _dolly dolly
`;
}

function fish(verbs: Verb[]): string {
  const lines = [
    "# dolly completions for fish. Install with:",
    "#   dolly completions fish > ~/.config/fish/completions/dolly.fish",
    "",
    "complete -c dolly -f",
  ];
  const d = (text: string) => q(text);
  for (const verb of verbs) {
    lines.push(
      `complete -c dolly -n __fish_use_subcommand -a ${verb.name} -d ${d(verb.description)}`,
    );
    const seen = `__fish_seen_subcommand_from ${verb.name}`;
    for (const flag of verb.flags) {
      const short = flag.short ? ` -s ${flag.short.replace(/^-/, "")}` : "";
      const value = flag.takesValue ? " -r" : "";
      lines.push(
        `complete -c dolly -n ${q(seen)}${short} -l ${flag.long.replace(/^--/, "")}${value} -d ${d(flag.description)}`,
      );
    }
    if (verb.patternFirst) lines.push(`complete -c dolly -n ${q(seen)} -a '(${PATTERN_NAMES})'`);
    if (verb.paths)
      lines.push(`complete -c dolly -n ${q(seen)} -a '(__fish_complete_directories)'`);
    for (const sub of verb.subcommands) {
      lines.push(`complete -c dolly -n ${q(seen)} -a ${sub.name} -d ${d(sub.description)}`);
      for (const flag of sub.flags) {
        const short = flag.short ? ` -s ${flag.short.replace(/^-/, "")}` : "";
        lines.push(
          `complete -c dolly -n ${q(`${seen}; and __fish_seen_subcommand_from ${sub.name}`)}${short} -l ${flag.long.replace(/^--/, "")}${flag.takesValue ? " -r" : ""} -d ${d(flag.description)}`,
        );
      }
    }
  }
  return `${lines.join("\\n")}\\n`;
}
