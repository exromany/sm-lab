import { Command } from 'commander';
import { VALIDATOR_STATUSES, DEFAULT_PORT } from '../types';

const GUIDE = `csm-cl-mock — Consensus Layer (Beacon API) mock for CSM testing

PURPOSE
  In-memory Beacon API fake. You configure validators over an admin HTTP API,
  then consumers hit the standard beacon endpoint. State lives only in the
  running server process — no files, no DB. Restart = clean slate.

TYPICAL WORKFLOW
  1. Start server:        csm-cl-mock serve
  2. Configure validators: csm-cl-mock config set <pubkey> <status> [eth]
  3. Consumers query:     GET /eth/v1/beacon/states/head/validators?id=<pubkey>
     (or via CLI:         csm-cl-mock query <pubkey>)
  4. Check health:        csm-cl-mock status
  5. Shut down:           csm-cl-mock stop   (or Ctrl+C on the server)

COMMANDS
  serve [--port N] [--host H]             start server (defaults: ${DEFAULT_PORT}, 127.0.0.1)
  config set <pubkey> <status> [eth]      register/update a validator
                                            [eth] = optional effective balance in
                                            ETH (e.g. 31.5); default 32
  config list                             list configured validators
  config remove <pubkey>                  remove one validator
  config reset                            clear all validators
  config statuses                         print valid statuses (offline)
  query [pubkey...] [--state id]          fetch & pretty-print beacon response
                                            (no args = query every configured validator)
  status [--json]                         server uptime, version, status breakdown
                                            exits 1 with "<url> offline (...)" if down
  stop                                    graceful shutdown
  help                                    this guide

REMOTE TARGET
  config/query/status/stop default to http://127.0.0.1:${DEFAULT_PORT}.
  Override with --url <url> (on the root command) or env CL_MOCK_URL.
    csm-cl-mock --url http://host:5052 config list
    CL_MOCK_URL=http://host:5052 csm-cl-mock status

PUBKEY FORMAT
  0x-prefixed 48-byte hex (96 hex chars). Case-insensitive at the store
  boundary — keys are normalized to lowercase.

VALID STATUSES
  ${VALIDATOR_STATUSES.join('\n  ')}

  Names ending in _slashed imply slashed:true. withdrawal_*_slashed are
  collapsed to their non-slashed counterparts in the API status field
  (matching real Beacon API behavior).

ADMIN HTTP API (for direct scripting without the CLI)
  GET    /admin/validators           → [{ pubkey, status, effective_balance? }]
  POST   /admin/validators           ← { pubkey, status, effective_balance? } | [...]
                                       effective_balance is a gwei integer string
                                       (e.g. "32000000000" for 32 ETH); optional,
                                       defaults to 32 ETH in beacon responses
  DELETE /admin/validators           clear all
  DELETE /admin/validators/:pubkey   remove one
  GET    /admin/status               → { ok, version, startedAt, uptimeSeconds,
                                         validators: { total, byStatus } }
  POST   /admin/shutdown             graceful shutdown

BEACON API (consumer-facing)
  GET /eth/v1/beacon/states/{state_id}/validators?id=<pubkey>[,<pubkey>...]
  Unconfigured pubkeys are omitted from the response.
  Auto-assigned indices start at 900000.
  effective_balance comes from config; balance mirrors it (both default to 32 ETH).

AGENT TIPS
  • Always 'csm-cl-mock status' before assuming a server is up — it prints a
    machine-parseable line on failure and exits 1.
  • Use 'config statuses' (no HTTP) to discover valid status values.
  • Batch multiple validators via POST /admin/validators with a JSON array.
  • State is ephemeral. If tests depend on a clean slate, call
    'config reset' (or DELETE /admin/validators) in setup.
`;

export const helpCommand = new Command('help')
  .description('Print an agent-friendly usage guide covering all commands')
  .action(() => {
    process.stdout.write(GUIDE);
  });
