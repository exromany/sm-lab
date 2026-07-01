---
'@sm-lab/cl-mock': patch
'@sm-lab/ipfs-mock': patch
---

Extract shared server internals into `@sm-lab/core` (bundled into each consumer, not
published): the Hono `startServer` scaffold + graceful shutdown, the `/admin/status` +
`/admin/shutdown` routes and runtime version read, and the `status`/`stop` CLI command
factories plus the URL/uptime helpers. cl-mock and ipfs-mock now consume core; their
published binaries, HTTP surface, and behavior are unchanged.
