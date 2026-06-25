# Built from the monorepo root (see docker/compose.yaml: context: ..).
# The image is a thin wrapper over the SAME bin published to npm — no parallel build.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @csm-lab/cl-mock build
# `pnpm deploy` produces a self-contained dir (package.json + dist + pruned prod node_modules)
RUN pnpm --filter @csm-lab/cl-mock deploy --prod /app

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app .
EXPOSE 5052
ENTRYPOINT ["node", "dist/cli.mjs"]
CMD ["serve", "--host", "0.0.0.0"]
