import { formatEther } from 'viem';
import {
  bigintReplacer,
  identity,
  toAddressValue,
  toBigInt,
  toHexValue,
  toNumber,
  type RecipeCommand,
} from '../define';
import {
  createCsmOperator,
  type CreateCsmOperatorOptions,
  type CreateCsmOperatorResult,
} from '../../recipes/create-operator';
import {
  registerModule,
  type RegisterModuleOptions,
  type RegisterModuleResult,
} from '../../recipes/register-module';
import { topUpQueue, type TopUpQueueSnapshot } from '../../recipes/topup';

export const csm02Commands: RecipeCommand[] = [
  {
    name: 'create-operator',
    summary: 'create a node operator with fresh keys + bond (PermissionlessGate only — csm02)',
    module: 'csm02',
    options: [
      {
        flag: '--keys <n>',
        key: 'keysCount',
        coerce: toNumber,
        positional: true,
        description: 'validator keys to submit at creation (default: 1)',
      },
      {
        flag: '--address <addr>',
        key: 'address',
        coerce: toAddressValue,
        description: 'operator address (default: derived from --seed)',
      },
      {
        flag: '--manager <addr>',
        key: 'manager',
        coerce: toAddressValue,
        description: 'manager address (default: the operator address)',
      },
      {
        flag: '--reward <addr>',
        key: 'reward',
        coerce: toAddressValue,
        description: 'reward address (default: the operator address)',
      },
      {
        flag: '--extended-manager-permissions',
        key: 'extendedManagerPermissions',
        description: 'set extendedManagerPermissions on the new operator',
      },
      {
        flag: '--seed <hex>',
        key: 'seed',
        coerce: toHexValue,
        description: 'determinism seed for the keys + derived address',
      },
    ],
    run: (ctx, o: CreateCsmOperatorOptions) => createCsmOperator(ctx, o),
    report: (r: CreateCsmOperatorResult) => [
      `operator ${r.noId} created — ${r.address}`,
      `bond: ${formatEther(r.bond)} ETH for ${r.publicKeys.length} key(s)`,
      ...r.publicKeys.map((pk) => `  ${pk}`),
    ],
  },
  {
    name: 'register-module',
    summary:
      "register the csm02 module in the StakingRouter (idempotent; clones an existing module's config)",
    module: 'csm02',
    options: [
      {
        flag: '--name <text>',
        key: 'name',
        coerce: identity,
        description: 'staking module display name (default: "CSM 0x02")',
      },
      {
        flag: '--source-module-id <id>',
        key: 'sourceModuleId',
        coerce: toBigInt,
        description: 'module id to clone the config from (default: the first registered module)',
      },
      {
        flag: '--stake-share-limit <n>',
        key: 'stakeShareLimit',
        coerce: toBigInt,
        description: 'override the cloned stakeShareLimit',
      },
      {
        flag: '--priority-exit-share-threshold <n>',
        key: 'priorityExitShareThreshold',
        coerce: toBigInt,
        description: 'override the cloned priorityExitShareThreshold',
      },
      {
        flag: '--staking-module-fee <n>',
        key: 'stakingModuleFee',
        coerce: toBigInt,
        description: 'override the cloned stakingModuleFee',
      },
      {
        flag: '--treasury-fee <n>',
        key: 'treasuryFee',
        coerce: toBigInt,
        description: 'override the cloned treasuryFee',
      },
      {
        flag: '--max-deposits-per-block <n>',
        key: 'maxDepositsPerBlock',
        coerce: toBigInt,
        description: 'override the cloned maxDepositsPerBlock',
      },
      {
        flag: '--min-deposit-block-distance <n>',
        key: 'minDepositBlockDistance',
        coerce: toBigInt,
        description: 'override the cloned minDepositBlockDistance',
      },
      {
        flag: '--withdrawal-credentials-type <n>',
        key: 'withdrawalCredentialsType',
        coerce: toBigInt,
        description: 'default: 2 for csm02 (EIP-7251), 1 otherwise',
      },
    ],
    run: (ctx, o: RegisterModuleOptions) => registerModule(ctx, o),
    report: (r: RegisterModuleResult) =>
      r.registered
        ? [
            `module ${r.moduleId} registered as "${r.name}"`,
            `config: ${JSON.stringify(r.config, bigintReplacer)}`,
          ]
        : [`already registered as module ${r.moduleId} (no write)`],
  },
  {
    name: 'top-up-queue',
    summary: 'read the csm02 top-up queue (read-only; enabled=false on a non-0x02 CSM)',
    module: 'csm02',
    options: [
      {
        flag: '--operator-id <id>',
        key: 'noId',
        coerce: toBigInt,
        description: 'filter items to this operator id',
      },
      {
        flag: '--limit <n>',
        key: 'limit',
        coerce: toNumber,
        description: 'max items to read (default 50)',
      },
    ],
    run: (ctx, o: { noId?: bigint; limit?: number }) => topUpQueue(ctx, o),
    report: (r: TopUpQueueSnapshot) =>
      r.enabled
        ? [
            `queue: ${r.length}/${r.limit} pending (head=${r.head})`,
            ...(r.items.length > 0
              ? r.items.map((it) => `  #${it.index}: operator ${it.noId} key ${it.keyIndex}`)
              : ['  (no items in range)']),
          ]
        : ['top-up queue disabled'],
  },
];
