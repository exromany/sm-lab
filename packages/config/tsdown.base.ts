import { defineConfig, type Options } from 'tsdown';

/**
 * Shared tsdown preset for every publishable package in csm-lab.
 *
 * Why this exists: the build strategy (formats, dts, how workspace internals are
 * handled) is a single decision that should live in ONE place. Each package calls
 * `libConfig()` and passes only its own entrypoints/overrides.
 *
 * `deps.alwaysBundle: [/^@csm-lab\//]` forces workspace internals like `@csm-lab/core`
 * to be bundled *into* each consumer's output (JS and dts) rather than left as runtime
 * deps. That keeps core private/unpublished and gives consumers a self-contained artifact
 * with no transitive `@csm-lab/*` to resolve. Third-party deps stay external as usual.
 */
export function libConfig(overrides: Options = {}): Options {
  return defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    // `eager` is required to bundle a source-only workspace dep's declarations
    // (@csm-lab/core has no emitted .d.ts) into the consumer's .d.mts.
    dts: { eager: true },
    clean: true,
    treeshake: true,
    sourcemap: true,
    deps: {
      alwaysBundle: [/^@csm-lab\//],
      dts: { alwaysBundle: [/^@csm-lab\//] },
    },
    ...overrides,
  }) as Options;
}

/** Preset for executable packages (CLIs / services): single binary entry, Node platform. */
export function binConfig(overrides: Options = {}): Options {
  return libConfig({
    entry: ['src/index.ts', 'src/cli.ts'],
    format: ['esm'],
    platform: 'node',
    ...overrides,
  });
}
