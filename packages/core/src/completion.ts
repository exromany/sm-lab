import { Argument, Command } from 'commander';
import type { Option } from 'commander';
import { findRoot } from './cli';

export type CompletionShell = 'bash' | 'zsh' | 'fish';

const SHELLS: readonly CompletionShell[] = ['bash', 'zsh', 'fish'];

// -- Normalised command tree --------------------------------------------------
// commander@15 has no completion support, so we snapshot the registered tree
// into plain data and emit a fully static script per shell (no runtime hooks).

interface OptionNode {
  /** Short flag with dash, e.g. `-c`. */
  short?: string;
  /** Long flag with dashes, e.g. `--count`. */
  long?: string;
  description: string;
  /** True when the option consumes a value (`<x>` or `[x]`). */
  takesValue: boolean;
  choices?: string[];
}

interface ArgNode {
  name: string;
  description: string;
  variadic: boolean;
  choices?: string[];
}

interface CommandNode {
  name: string;
  aliases: string[];
  description: string;
  /** Canonical subcommand names from the root down to this node ([] for the root itself). */
  path: string[];
  options: OptionNode[];
  args: ArgNode[];
  children: CommandNode[];
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').trim();
}

function toNode(cmd: Command, path: string[]): CommandNode {
  return {
    name: cmd.name(),
    aliases: [...cmd.aliases()],
    description: firstLine(cmd.description()),
    path,
    options: cmd.options
      .filter((o: Option) => !o.hidden)
      .map((o: Option) => ({
        short: o.short,
        long: o.long,
        description: firstLine(o.description),
        takesValue: o.required || o.optional,
        choices: o.argChoices ? [...o.argChoices] : undefined,
      })),
    args: cmd.registeredArguments.map((a: Argument) => ({
      name: a.name(),
      description: firstLine(a.description),
      variadic: a.variadic,
      choices: a.argChoices ? [...a.argChoices] : undefined,
    })),
    children: cmd.commands.map((c) => toNode(c, [...path, c.name()])),
  };
}

/** Flatten in registration order — the emitters iterate this, so output is deterministic. */
function walk(node: CommandNode): CommandNode[] {
  return [node, ...node.children.flatMap(walk)];
}

function namesOf(node: CommandNode): string[] {
  return [node.name, ...node.aliases];
}

// -- fish ---------------------------------------------------------------------

function fishQuote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function emitFish(bin: string, root: CommandNode): string {
  const lines = [
    `# fish completion for ${bin}`,
    `# Load with: ${bin} completion fish | source`,
    `# Or install: ${bin} completion fish > ~/.config/fish/completions/${bin}.fish`,
  ];
  for (const node of walk(root)) {
    const seen = node.path.map((p) => `__fish_seen_subcommand_from ${p}`);
    const childNames = node.children.flatMap(namesOf);
    const hereParts = [...seen];
    // `-f` on subcommand candidates suppresses file completion at this position;
    // positions with no matching rule keep fish's default file completion.
    if (childNames.length > 0) {
      hereParts.push(`not __fish_seen_subcommand_from ${childNames.join(' ')}`);
    }
    const here = hereParts.length > 0 ? ` -n ${fishQuote(hereParts.join('; and '))}` : '';
    for (const child of node.children) {
      for (const name of namesOf(child)) {
        lines.push(`complete -c ${bin}${here} -f -a ${name} -d ${fishQuote(child.description)}`);
      }
    }
    for (const opt of node.options) {
      let line = `complete -c ${bin}${here}`;
      if (opt.short) line += ` -s ${opt.short.replace(/^-+/, '')}`;
      if (opt.long) line += ` -l ${opt.long.replace(/^-+/, '')}`;
      if (opt.takesValue) {
        line += opt.choices ? ` -x -a ${fishQuote(opt.choices.join(' '))}` : ' -r';
      }
      line += ` -d ${fishQuote(opt.description)}`;
      lines.push(line);
    }
    const atArgs = seen.length > 0 ? ` -n ${fishQuote(seen.join('; and '))}` : '';
    for (const arg of node.args) {
      if (arg.choices) {
        const desc = arg.description || arg.name;
        lines.push(
          `complete -c ${bin}${atArgs} -f -a ${fishQuote(arg.choices.join(' '))} -d ${fishQuote(desc)}`,
        );
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

// -- bash ---------------------------------------------------------------------

function sanitizeIdent(bin: string): string {
  return bin.replace(/[^A-Za-z0-9_]/g, '_');
}

/**
 * Case arms that descend the known subcommand tree token by token, normalising
 * aliases to the canonical path so a single lookup table serves both spellings.
 */
function descentCases(root: CommandNode, indent: string): string[] {
  return walk(root)
    .filter((node) => node.path.length > 0)
    .map((node) => {
      const parent = node.path.slice(0, -1).join(' ');
      const patterns = namesOf(node)
        .map((name) => `"${parent ? `${parent} ${name}` : name}"`)
        .join('|');
      return `${indent}${patterns}) path="${node.path.join(' ')}" ;;`;
    });
}

function emitBash(bin: string, root: CommandNode): string {
  const fn = `_${sanitizeIdent(bin)}_completions`;
  const optCases = walk(root).map((node) => {
    const subs = node.children.flatMap(namesOf).join(' ');
    const flags = node.options
      .flatMap((o) => [o.short, o.long])
      .filter((f): f is string => f !== undefined)
      .join(' ');
    const args = node.args.flatMap((a) => a.choices ?? []).join(' ');
    return `    "${node.path.join(' ')}") subs="${subs}"; flags="${flags}"; args="${args}" ;;`;
  });
  return [
    `# bash completion for ${bin}`,
    `# Load with: source <(${bin} completion bash)`,
    `${fn}() {`,
    '  local cur path try w i subs flags args',
    '  cur="${COMP_WORDS[COMP_CWORD]}"',
    '  path=""',
    '  for ((i = 1; i < COMP_CWORD; i++)); do',
    '    w="${COMP_WORDS[i]}"',
    '    [[ "$w" == -* ]] && continue',
    '    try="${path:+$path }$w"',
    '    case "$try" in',
    ...descentCases(root, '      '),
    '      *) ;;',
    '    esac',
    '  done',
    '  subs=""; flags=""; args=""',
    '  case "$path" in',
    ...optCases,
    '  esac',
    '  if [[ "$cur" == -* ]]; then',
    '    COMPREPLY=($(compgen -W "$flags" -- "$cur"))',
    '  elif [[ -n "$subs" ]]; then',
    '    COMPREPLY=($(compgen -W "$subs" -- "$cur"))',
    '  elif [[ -n "$args" ]]; then',
    '    COMPREPLY=($(compgen -W "$args" -- "$cur"))',
    '  else',
    '    COMPREPLY=($(compgen -f -- "$cur"))',
    '  fi',
    '}',
    `complete -F ${fn} ${bin}`,
    '',
  ].join('\n');
}

// -- zsh ----------------------------------------------------------------------

function zshItem(name: string, description: string): string {
  const entry = `${name}:${description}`.replace(/'/g, `'\\''`);
  return `'${entry}'`;
}

function emitZsh(bin: string, root: CommandNode): string {
  const fn = `_${sanitizeIdent(bin)}`;
  const optCases = walk(root).map((node) => {
    const subs = node.children
      .flatMap((child) => namesOf(child).map((name) => zshItem(name, child.description)))
      .join(' ');
    const flags = node.options
      .flatMap((o) =>
        [o.short, o.long]
          .filter((f): f is string => f !== undefined)
          .map((f) => zshItem(f, o.description)),
      )
      .join(' ');
    const args = node.args
      .flatMap((a) => (a.choices ?? []).map((c) => zshItem(c, a.description || a.name)))
      .join(' ');
    const body = [
      subs ? `subs=(${subs})` : undefined,
      flags ? `flags=(${flags})` : undefined,
      args ? `argwords=(${args})` : undefined,
    ]
      .filter((p) => p !== undefined)
      .join('; ');
    return `    "${node.path.join(' ')}") ${body ? `${body} ` : ''};;`;
  });
  return [
    `#compdef ${bin}`,
    `# zsh completion for ${bin}`,
    `# Install: ${bin} completion zsh > "\${fpath[1]}/_${bin}" (then restart zsh)`,
    `${fn}() {`,
    '  local -a subs flags argwords',
    '  local path="" try w',
    '  for w in "${(@)words[2,CURRENT-1]}"; do',
    '    [[ "$w" == -* ]] && continue',
    '    try="${path:+$path }$w"',
    '    case "$try" in',
    ...descentCases(root, '      '),
    '      *) ;;',
    '    esac',
    '  done',
    '  case "$path" in',
    ...optCases,
    '  esac',
    '  if [[ "$PREFIX" == -* ]]; then',
    "    (( ${#flags[@]} )) && _describe -t options 'option' flags",
    '  elif (( ${#subs[@]} )); then',
    "    _describe -t commands 'command' subs",
    '  elif (( ${#argwords[@]} )); then',
    "    _describe -t values 'value' argwords",
    '  else',
    '    _files',
    '  fi',
    '}',
    `if [[ "\${funcstack[1]}" == "${fn}" ]]; then`,
    `  ${fn} "$@"`,
    'else',
    `  compdef ${fn} ${bin}`,
    'fi',
    '',
  ].join('\n');
}

// -- public API -----------------------------------------------------------------

/**
 * Build a fully static, self-contained shell-completion script for `root`'s command
 * tree (subcommands at any depth, aliases, flags, option/argument choices). Pure:
 * output depends only on the tree, iterated in registration order.
 */
export function buildCompletionScript(root: Command, shell: CompletionShell): string {
  const bin = root.name();
  const tree = toNode(root, []);
  switch (shell) {
    case 'fish':
      return emitFish(bin, tree);
    case 'bash':
      return emitBash(bin, tree);
    case 'zsh':
      return emitZsh(bin, tree);
  }
}

/**
 * Build a `completion <shell>` subcommand that prints the static completion script
 * for the ROOT program (resolved by walking `.parent`) to stdout.
 */
export function createCompletionCommand(): Command {
  return new Command('completion')
    .description(
      'Print a static shell-completion script for bash, zsh or fish. ' +
        'Load it in your shell, e.g. fish: `sm-cl completion fish | source`',
    )
    .addArgument(new Argument('<shell>', 'target shell').choices(SHELLS))
    .action((shell: CompletionShell, _opts: unknown, cmd: Command) => {
      process.stdout.write(buildCompletionScript(findRoot(cmd), shell));
    });
}
