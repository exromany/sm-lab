import { buildAddressesTree } from '@sm-lab/merkle';
import { permissionlessGateAbi, vettedGateAbi } from '@sm-lab/receipts';
import type { CsmAddressBook, Hex } from '@sm-lab/receipts';
import { getAddress, parseEther, zeroAddress } from 'viem';
import { ACT_AS_FUNDING, actAs, roleMember } from '../act-as';
import { contract, resolveGate, type Ctx } from '../context';
import { deriveAddress } from '../derive';
import { randomKeys } from '../keys';
import { randomSeed } from '../random';
import { DEFAULT_ADMIN_ROLE, RESUME_ROLE } from '../roles';
import { addGateAddrs } from './add-gate';

export interface CreateCsmOperatorOptions {
  /** Validator keys submitted at creation (CSM requires ≥ 1). Default 1. */
  keysCount?: number;
  /**
   * Entry gate — the operator's "type" (the gate pins the bond curve). Absent →
   * PermissionlessGate (no proof); 'ics' | 'idvtc' | a raw 0x… gate address → vetted gate
   * (the address is appended to the gate allowlist via addGateAddrs and proven).
   */
  selector?: string;
  /** The operator/sender address. Default: deriveAddress(seed, 'csm-operator'). */
  address?: Hex;
  /** managementProperties.managerAddress; zeroAddress (default) → contract uses the sender. */
  manager?: Hex;
  /** managementProperties.rewardAddress; zeroAddress (default) → contract uses the sender. */
  reward?: Hex;
  /** managementProperties.extendedManagerPermissions. Default false. */
  extendedManagerPermissions?: boolean;
  /** Injectable seed for reproducible keys + derived address. */
  seed?: Hex;
  /** Gated: read the current tree from this CID instead of the gate's treeCid(). */
  fromCid?: string;
  /** Gated: skip pinning the merged tree by supplying its CID (hermetic-test bypass). */
  cid?: string;
}

export interface CreateCsmOperatorResult {
  noId: bigint;
  /** The created operator's sender/owner address (checksummed). */
  address: Hex;
  publicKeys: Hex[];
  /** Wei sent as the creation bond. */
  bond: bigint;
  /** Gated path only — the gate's allowlist CID (re-pinned when the address was newly added). */
  treeCid?: string;
}

/**
 * Create a CSM node operator through an entry gate, submitting `keysCount` fresh keys and the
 * exact ETH bond. No selector → PermissionlessGate; 'ics'/'idvtc'/0x… → the vetted gate: the
 * address is persistently whitelisted first (addGateAddrs) and proven against the merged tree.
 * A paused vetted gate is resumed as its admin (VettedGate creation is `whenResumed`). No
 * post-assertions — returns the simulate-captured noId.
 */
export async function createCsmOperator(
  ctx: Ctx,
  opts: CreateCsmOperatorOptions = {},
): Promise<CreateCsmOperatorResult> {
  if (ctx.module !== 'csm') {
    throw new Error('@sm-lab/recipes: createCsmOperator requires ctx.module === "csm"');
  }
  const keysCount = opts.keysCount ?? 1;
  if (keysCount < 1 || !Number.isInteger(keysCount)) {
    throw new Error(
      '@sm-lab/recipes: createCsmOperator needs keysCount to be a positive integer ≥ 1 (CSM requires a key at creation)',
    );
  }
  const seed = opts.seed ?? randomSeed();
  const address = getAddress(opts.address ?? deriveAddress(seed, 'csm-operator'));
  const { publicKeys, packedKeys, packedSignatures } = await randomKeys(keysCount, seed);
  const mgmt = {
    managerAddress: opts.manager ?? zeroAddress,
    rewardAddress: opts.reward ?? zeroAddress,
    extendedManagerPermissions: opts.extendedManagerPermissions ?? false,
  } as const;

  // Gate resolution: the entry gate IS the operator's type (it pins the bond curve).
  let curveId: bigint;
  let gateAddress: Hex;
  let proof: Hex[] | undefined;
  let treeCid: string | undefined;
  if (opts.selector === undefined) {
    gateAddress = (ctx.addresses as CsmAddressBook).PermissionlessGate;
    curveId = (await ctx.client.readContract({
      address: gateAddress,
      abi: permissionlessGateAbi,
      functionName: 'CURVE_ID',
    })) as bigint;
  } else {
    gateAddress = resolveGate(ctx, opts.selector);
    const gate = { address: gateAddress, abi: vettedGateAbi } as const;
    const merged = await addGateAddrs(ctx, {
      selector: opts.selector,
      addresses: [address],
      fromCid: opts.fromCid,
      cid: opts.cid,
    });
    treeCid = merged.treeCid;
    proof = buildAddressesTree(merged.addresses).getProof([address]) as Hex[];
    // VettedGate creation is whenResumed — resume a paused gate as its admin first.
    const paused = await ctx.client.readContract({ ...gate, functionName: 'isPaused' });
    if (paused) {
      const admin = await roleMember(ctx, gate, DEFAULT_ADMIN_ROLE);
      await actAs(ctx, admin, async (from) => {
        await ctx.client.writeContract({
          ...gate,
          functionName: 'grantRole',
          args: [RESUME_ROLE, admin],
          account: from,
          chain: null,
        });
        await ctx.client.writeContract({
          ...gate,
          functionName: 'resume',
          account: from,
          chain: null,
        });
      });
    }
    curveId = (await ctx.client.readContract({ ...gate, functionName: 'curveId' })) as bigint;
  }

  const acc = contract(ctx, 'Accounting');
  const bond = (await ctx.client.readContract({
    ...acc,
    functionName: 'getBondAmountByKeysCount',
    args: [BigInt(keysCount), curveId],
  })) as bigint;

  const noId = await actAs(ctx, address, async (from) => {
    // actAs funds 100 ETH on entry — enough for most bonds; top up when the bond outgrows it.
    if (bond + parseEther('1') > ACT_AS_FUNDING) {
      await ctx.client.setBalance({ address: from, value: bond + parseEther('10') });
    }
    // Two full branches (not a shared ternary `request`) — the vetted/permissionless
    // addNodeOperatorETH overloads differ in arg count (proof at index 4), and viem can't
    // narrow a union `{ abi, args }` spread back into a single writeContract overload.
    if (proof) {
      const { result, request } = await ctx.client.simulateContract({
        address: gateAddress,
        abi: vettedGateAbi,
        functionName: 'addNodeOperatorETH',
        args: [BigInt(keysCount), packedKeys, packedSignatures, mgmt, proof, zeroAddress],
        account: from,
        value: bond,
      });
      await ctx.client.writeContract({ ...request, chain: null });
      return result as bigint;
    }
    const { result, request } = await ctx.client.simulateContract({
      address: gateAddress,
      abi: permissionlessGateAbi,
      functionName: 'addNodeOperatorETH',
      args: [BigInt(keysCount), packedKeys, packedSignatures, mgmt, zeroAddress],
      account: from,
      value: bond,
    });
    await ctx.client.writeContract({ ...request, chain: null });
    return result as bigint;
  });

  return { noId, address, publicKeys, bond, ...(treeCid !== undefined ? { treeCid } : {}) };
}
