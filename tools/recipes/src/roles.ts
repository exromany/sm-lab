import { keccak256, toBytes } from 'viem';
import type { Hex } from '@sm-lab/receipts';

/** OZ AccessControl default admin role (all-zero bytes32). */
export const DEFAULT_ADMIN_ROLE = `0x${'0'.repeat(64)}` as Hex;
/** MerkleGate: keccak256("SET_TREE_ROLE"). */
export const SET_TREE_ROLE = keccak256(toBytes('SET_TREE_ROLE'));
/** PausableWithRoles: keccak256("RESUME_ROLE"). */
export const RESUME_ROLE = keccak256(toBytes('RESUME_ROLE'));
/** BaseModule: keccak256("REPORT_GENERAL_DELAYED_PENALTY_ROLE"). */
export const REPORT_GENERAL_DELAYED_PENALTY_ROLE = keccak256(
  toBytes('REPORT_GENERAL_DELAYED_PENALTY_ROLE'),
);
/** BaseModule: keccak256("SETTLE_GENERAL_DELAYED_PENALTY_ROLE"). */
export const SETTLE_GENERAL_DELAYED_PENALTY_ROLE = keccak256(
  toBytes('SETTLE_GENERAL_DELAYED_PENALTY_ROLE'),
);
