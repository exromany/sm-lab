import { defineConfig, type UserConfig } from 'tsdown';

/**
 * Shared tsdown preset for every publishable package in sm-lab.
 *
 * Why this exists: the build strategy (formats, dts, how workspace internals are
 * handled) is a single decision that should live in ONE place. Each package calls
 * `libConfig()` and passes only its own entrypoints/overrides.
 *
 * `deps.alwaysBundle: [/^@sm-lab\//]` forces workspace internals like `@sm-lab/core`
 * to be bundled *into* each consumer's output (JS and dts) rather than left as runtime
 * deps. That keeps core private/unpublished and gives consumers a self-contained artifact
 * with no transitive `@sm-lab/*` to resolve. Third-party deps stay external as usual.
 */
export function libConfig(overrides: UserConfig = {}): UserConfig {
  return defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    // `eager` is required to bundle a source-only workspace dep's declarations
    // (@sm-lab/core has no emitted .d.ts) into the consumer's .d.mts.
    dts: { eager: true },
    clean: true,
    treeshake: true,
    sourcemap: true,
    inputOptions: {
      onLog(level, log, defaultHandler) {
        // rolldown-plugin-dts emits a map-less `export {};` for EMPTY dts chunks (cli entries with
        // zero type exports), which `sourcemap: true` flags — mute only this exact code+plugin pair.
        if (log.code === 'SOURCEMAP_BROKEN' && log.plugin === 'rolldown-plugin-dts:fake-js') return;
        defaultHandler(level, log);
      },
    },
    deps: {
      alwaysBundle: [/^@sm-lab\//],
      dts: { alwaysBundle: [/^@sm-lab\//] },
    },
    ...overrides,
  }) as UserConfig;
}

/** Preset for executable packages (CLIs / services): single binary entry, Node platform. */
export function binConfig(overrides: UserConfig = {}): UserConfig {
  return libConfig({
    entry: ['src/index.ts', 'src/cli.ts'],
    format: ['esm'],
    platform: 'node',
    ...overrides,
  });
}
