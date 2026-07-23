# @sm-lab/survey

## 0.2.0

### Minor Changes

- d521db8: Publish `@sm-lab/survey` to npm (`sm-survey` bin, runnable via `npx`). Drops `private`, adds
  publish metadata, and defers the DB connection until a command runs so `--help` works without
  `DATABASE_URL`.
