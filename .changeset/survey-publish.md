---
'@sm-lab/survey': minor
---

Publish `@sm-lab/survey` to npm (`sm-survey` bin, runnable via `npx`). Drops `private`, adds
publish metadata, and defers the DB connection until a command runs so `--help` works without
`DATABASE_URL`.
