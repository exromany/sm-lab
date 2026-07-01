---
'@sm-lab/cl': minor
---

Migrate the cl-mock service into the sm-lab monorepo as `@sm-lab/cl`. Build moves from
`tsc` to tsdown (ESM, bundled), entrypoints split into a library export (`.`) and the
`sm-cl` bin (run via `npx @sm-lab/cl`). Fixes the version lookup path for the bundled output layout; adds the first
Vitest characterization tests for the Beacon API response shape.
