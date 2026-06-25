---
'@csm-lab/cl-mock': patch
'@csm-lab/ipfs-mock': patch
---

Extract shared server internals into `@csm-lab/core` (bundled into each consumer, not
published): the Hono `startServer` scaffold + graceful shutdown, the `/admin/status` +
`/admin/shutdown` routes and runtime version read, and the `status`/`stop` CLI command
factories plus the URL/uptime helpers. cl-mock and ipfs-mock now consume core; their
published binaries, HTTP surface, and behavior are unchanged.
