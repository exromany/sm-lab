# Built from the monorepo root (see docker/compose.yaml: context: ..).
# The image is a thin wrapper over the SAME bin published to npm — no parallel build.
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sm-lab/ipfs build
# `pnpm deploy` produces a self-contained dir (package.json + dist + pruned prod node_modules).
# --legacy: no workspace packages in prod deps (core/config are bundled), so injected deploy is unneeded.
RUN pnpm --filter @sm-lab/ipfs deploy --legacy --prod /app

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app .
EXPOSE 5001
ENTRYPOINT ["node", "dist/cli.mjs"]
CMD ["serve", "--host", "0.0.0.0"]
