import { Command } from 'commander';
import { DEFAULT_GATEWAYS, DEFAULT_PORT } from '../types';

const GUIDE = `sm-ipfs — Pinata-compatible IPFS pinning + gateway mock for Lido SM testing

PURPOSE
  A drop-in stand-in for Pinata. Point @pinata/sdk (or any fetch client) at this
  server: pin JSON/files over the Pinata API, then read them back through the IPFS
  gateway route. Unknown CIDs (never pinned here) are transparently proxied to a real
  public IPFS gateway, so reads of production content still work offline-of-Pinata.

TYPICAL WORKFLOW
  1. Start server:   sm-ipfs serve
  2. Pin JSON:       POST /pinning/pinJSONToIPFS    → { IpfsHash, PinSize, Timestamp }
  3. Read it back:   GET  /ipfs/<IpfsHash>          → the stored bytes
  4. List / unpin:   GET  /data/pinList  •  DELETE /pinning/unpin/<cid>
  5. Check health:   sm-ipfs status
  6. Shut down:      sm-ipfs stop   (or Ctrl+C on the server)

COMMANDS
  serve [--port N] [--host H] [--gateway URL] [--persist DIR] [--state FILE]
                                start server (defaults: ${DEFAULT_PORT}, 127.0.0.1)
                                  --gateway  upstream gateway(s) for store-miss CIDs
                                             (comma-separated → fallback chain)
                                  --persist  mirror pins to DIR so they survive restarts
                                  --state    load FILE on boot, save it on graceful shutdown
                                  --persist is a per-pin directory mirror (written as pins
                                  change); --state is a single JSON snapshot of the whole
                                  store. In-memory only if both are omitted.
  status [--json]               server uptime, version, pin count, configured gateway
                                  exits 1 with "<url> offline (...)" if down
  stop                          graceful shutdown
  completion <shell>            print a static bash/zsh/fish completion script
                                  e.g. sm-ipfs completion fish | source
  help                          this guide

PINATA-COMPATIBLE HTTP API
  POST   /pinning/pinJSONToIPFS   ← JSON body (bare, or { pinataContent, pinataMetadata })
                                  → { IpfsHash, PinSize, Timestamp }
  POST   /pinning/pinFileToIPFS   ← multipart/form-data, field "file"
                                  → { IpfsHash, PinSize, Timestamp }
  GET    /data/pinList            → { count, rows: [{ ipfs_pin_hash, size, date_pinned, ... }] }
  DELETE /pinning/unpin/:cid      remove a pin (404 if absent)

IPFS GATEWAY (consumer-facing read path)
  GET /ipfs/:cid
    • store HIT  → serves the stored bytes (no network call)
    • store MISS → proxies to the upstream gateway(s) and relays the body/status;
                   successful proxied content is cached back into the store.
    • invalid CID → 400; all upstreams unreachable → 502; timeout → 504.

UPSTREAM GATEWAYS (for store-miss CIDs)
  Default fallback chain (tried in order, first 2xx wins; a miss/failure falls through):
    ${DEFAULT_GATEWAYS.join('  →  ')}
  Override (highest priority last): bundled defaults < env IPFS_UPSTREAM_GATEWAY < serve --gateway
  A comma-separated value sets a multi-gateway chain; a single value replaces it entirely.
    IPFS_UPSTREAM_GATEWAY=https://ipfs.io,https://dweb.link sm-ipfs serve
    sm-ipfs serve --gateway https://ipfs.io

CID FORMAT — IMPORTANT
  CIDs are deterministic: CIDv1 / raw codec (0x55) / sha2-256 over the content bytes.
  Same content → same CID, every run, no network. These are REAL, valid CIDs.
  CAVEAT: they will NOT byte-match \`ipfs add\`'s default CID, which wraps content in a
  UnixFS dag-pb node before hashing. Exact production parity would need
  ipfs-unixfs-importer (out of scope). For round-tripping content through THIS mock and
  pinning stable fixtures, deterministic addressing is what matters.

REMOTE TARGET
  status/stop default to http://127.0.0.1:${DEFAULT_PORT}.
  Override with --url <url> (on the root command) or env IPFS_MOCK_URL.
    sm-ipfs --url http://host:${DEFAULT_PORT} status
    IPFS_MOCK_URL=http://host:${DEFAULT_PORT} sm-ipfs stop

FLAGS
  --json   (on status) emit a single JSON value to stdout instead of human-readable text.
           Exit code is still 0/1 (success/error). Nothing else is written to stdout.
           Errors always go to stderr regardless of --json.

  Examples:
    sm-ipfs status --json
    sm-ipfs --url http://host:${DEFAULT_PORT} status --json

AGENT TIPS
  • Always 'sm-ipfs status' before assuming a server is up — it prints a
    machine-parseable line on failure and exits 1.
  • State is in-memory by default → restart = clean slate. Use --persist DIR or
    --state FILE to keep it.
  • A GET /ipfs/:cid that hits an unpinned CID WILL touch the network (the upstream
    gateway). In hermetic tests, only read CIDs you pinned, or inject a stub fetcher
    via the createApp({ fetchUpstream }) library API.
`;

export const helpCommand = new Command('help')
  .description('Print an agent-friendly usage guide covering all commands')
  .action(() => {
    process.stdout.write(GUIDE);
  });
