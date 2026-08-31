import type { ModuleName } from '@sm-lab/receipts';

// Capability table (mirrors lido-csm-sdk's module-name taxonomy) — adding a module is a table
// edit here, not a grep-and-patch across every ctx.module === '…' branch.

/** Modules with named, merkle-allowlisted entry gates (csm02 has only a PermissionlessGate). */
export const NAMED_GATE_MODULES: ReadonlySet<ModuleName> = new Set(['csm', 'cm']);
