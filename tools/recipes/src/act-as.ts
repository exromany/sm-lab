import { parseEther } from 'viem';
import type { Abi } from 'viem';
import type { Hex } from '@sm-lab/receipts';
import type { Ctx } from './context';

/**
 * Run `fn` as a privileged account `who` on the fork. Funds it (anvil_setBalance),
 * unlocks it (anvil_impersonateAccount), runs the body, and always stops impersonating.
 * Replaces every Solidity `broadcast*` modifier. `who` is a RAW address — pass a contract
 * address (e.g. the module, verifier, stakingRouter) or a role member resolved via roleMember.
 */
export async function actAs<T>(ctx: Ctx, who: Hex, fn: (from: Hex) => Promise<T>): Promise<T> {
  await ctx.client.setBalance({ address: who, value: parseEther('100') });
  await ctx.client.impersonateAccount({ address: who });
  try {
    return await fn(who);
  } finally {
    await ctx.client.stopImpersonatingAccount({ address: who });
  }
}

/** Read `getRoleMember(role, 0)` — the canonical admin/governance member of an AccessControl role. */
export async function roleMember(
  ctx: Ctx,
  target: { address: Hex; abi: Abi },
  role: Hex,
): Promise<Hex> {
  const member = await ctx.client.readContract({
    address: target.address,
    abi: target.abi,
    functionName: 'getRoleMember',
    args: [role, 0n],
  });
  return member as Hex;
}
