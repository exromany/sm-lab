import { afterEach, describe, expect, it, vi } from 'vitest';
import { Argument, Command } from 'commander';
import { buildCompletionScript, createCompletionCommand } from './completion';
import type { CompletionShell } from './completion';

afterEach(() => vi.restoreAllMocks());

const SHELLS: CompletionShell[] = ['bash', 'zsh', 'fish'];

/** Root + option + nested group with a subcommand — the sm-recipes shape in miniature. */
function makeProgram(): Command {
  const program = new Command('sm-test').description('Test bin');
  program.option('--url <url>', 'server URL override');
  program
    .command('status')
    .description('Show mock server status')
    .option('--json', 'output raw JSON');
  const group = program.command('cm').alias('curated').description('Curated module recipes');
  group
    .command('add-keys')
    .description('Add keys to an operator')
    .option('-c, --count <n>', 'number of keys')
    .option('--operator-id <id>', 'operator id')
    .addArgument(new Argument('[mode]', 'key mode').choices(['real', 'stub']));
  return program;
}

describe('buildCompletionScript', () => {
  for (const shell of SHELLS) {
    describe(shell, () => {
      const script = buildCompletionScript(makeProgram(), shell);

      it('names the bin', () => {
        expect(script).toContain('sm-test');
      });

      it('reaches the nested subcommand under the group', () => {
        expect(script).toContain('cm');
        expect(script).toContain('add-keys');
      });

      it('includes long flags (root and nested)', () => {
        // fish declares long flags as `-l <name>`; bash/zsh keep the literal `--<name>`.
        const [url, operatorId] =
          shell === 'fish' ? ['-l url', '-l operator-id'] : ['--url', '--operator-id'];
        expect(script).toContain(url);
        expect(script).toContain(operatorId);
      });

      it('includes the short flag and the group alias', () => {
        expect(script).toContain('-c');
        expect(script).toContain('curated');
      });

      it('includes argument choices', () => {
        expect(script).toContain('real');
        expect(script).toContain('stub');
      });

      it('is deterministic across calls', () => {
        expect(buildCompletionScript(makeProgram(), shell)).toBe(script);
      });
    });
  }

  it('fish carries per-candidate descriptions via -d', () => {
    const script = buildCompletionScript(makeProgram(), 'fish');
    expect(script).toContain("-a add-keys -d 'Add keys to an operator'");
    expect(script).toContain("-l operator-id -r -d 'operator id'");
  });

  it('fish scopes nested candidates to the subcommand path', () => {
    const script = buildCompletionScript(makeProgram(), 'fish');
    expect(script).toContain('__fish_seen_subcommand_from cm; and __fish_seen_subcommand_from');
  });

  it('bash registers a complete -F function for the bin', () => {
    const script = buildCompletionScript(makeProgram(), 'bash');
    expect(script).toContain('complete -F _sm_test_completions sm-test');
    expect(script).toContain('COMP_WORDS');
  });

  it('zsh starts with #compdef and describes candidates', () => {
    const script = buildCompletionScript(makeProgram(), 'zsh');
    expect(script.startsWith('#compdef sm-test\n')).toBe(true);
    expect(script).toContain("'add-keys:Add keys to an operator'");
  });
});

describe('createCompletionCommand', () => {
  it('prints the root program script to stdout', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    const program = makeProgram();
    program.addCommand(createCompletionCommand());
    await program.parseAsync(['node', 'sm-test', 'completion', 'fish']);
    const out = chunks.join('');
    expect(out).toContain('complete -c sm-test');
    expect(out).toContain('add-keys');
  });

  it('rejects an unknown shell', async () => {
    const program = makeProgram().exitOverride();
    // addCommand does not copy inherited settings — override exit on the subcommand itself.
    program.addCommand(createCompletionCommand().exitOverride());
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(
      program.parseAsync(['node', 'sm-test', 'completion', 'powershell']),
    ).rejects.toThrow(/Allowed choices are bash, zsh, fish/);
  });
});
