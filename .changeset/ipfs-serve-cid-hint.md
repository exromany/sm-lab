---
'@sm-lab/ipfs': patch
---

`sm-ipfs serve` now prints a `fetch a CID: <url>/ipfs/<cid>` hint in its startup banner, so the
gateway read path is discoverable without opening `sm-ipfs help`.
