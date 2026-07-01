import { Command } from 'commander';
import { DEFAULT_GATEWAY, DEFAULT_PORT } from '../types';

const GUIDE = `sm-ipfs — Pinata-compatible IPFS pinning + gateway mock for CSM testing

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
  serve [--port N] [--host H] [--gateway URL] [--persist DIR]
                                start server (defaults: ${DEFAULT_PORT}, 127.0.0.1)
                                  --gateway  upstream IPFS gateway for store-miss CIDs
                                  --persist  mirror pins to DIR so they survive restarts
                                             (in-memory only if omitted)
  status [--json]               server uptime, version, pin count, configured gateway
                                  exits 1 with "<url> offline (...)" if down
  stop                          graceful shutdown
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
    • store MISS → proxies to the upstream gateway and relays its body/status;
                   successful proxied content is cached back into the store.
    • invalid CID → 400; upstream unreachable → 502; upstream timeout → 504.

UPSTREAM GATEWAY (for store-miss CIDs)
  Default:  ${DEFAULT_GATEWAY}
  Override (highest priority last): bundled default < env IPFS_UPSTREAM_GATEWAY < serve --gateway
    IPFS_UPSTREAM_GATEWAY=https://ipfs.io sm-ipfs serve
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

AGENT TIPS
  • Always 'sm-ipfs status' before assuming a server is up — it prints a
    machine-parseable line on failure and exits 1.
  • State is in-memory by default → restart = clean slate. Use --persist DIR to keep it.
  • A GET /ipfs/:cid that hits an unpinned CID WILL touch the network (the upstream
    gateway). In hermetic tests, only read CIDs you pinned, or inject a stub fetcher
    via the createApp({ fetchUpstream }) library API.
`;

export const helpCommand = new Command('help')
  .description('Print an agent-friendly usage guide covering all commands')
  .action(() => {
    process.stdout.write(GUIDE);
  });
