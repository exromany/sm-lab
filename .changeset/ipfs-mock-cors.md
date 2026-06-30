---
'@csm-lab/ipfs-mock': minor
---

feat: enable permissive CORS on the pinning API + `/ipfs/:cid` gateway. The mock backs
browser consumers (e.g. csm-widget) cross-origin, so it now answers preflight `OPTIONS`
and returns `Access-Control-Allow-Origin: *` on every route — fetches from a `localhost`
dev server no longer fail with a CORS error.
