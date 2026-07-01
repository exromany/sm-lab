---
'@sm-lab/cl-mock': minor
---

Migrate `csm-cl-mock` into the csm-lab monorepo as `@sm-lab/cl-mock`. Build moves from
`tsc` to tsdown (ESM, bundled), entrypoints split into a library export (`.`) and the
`csm-cl-mock` bin. The binary name is unchanged, so `npx @sm-lab/cl-mock` / `csm-cl-mock`
keep working. Fixes the version lookup path for the bundled output layout; adds the first
Vitest characterization tests for the Beacon API response shape.
