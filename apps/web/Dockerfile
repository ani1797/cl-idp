# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS deps

WORKDIR /workspace/apps/web

COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder

WORKDIR /workspace/apps/web

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ENV NODE_ENV=production \
    NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

COPY --from=deps /workspace/apps/web/node_modules ./node_modules
COPY . .
COPY --from=shared . /workspace/packages/shared

RUN npm run build \
    && cp -r .next/static .next/standalone/apps/web/.next/ \
    && cp -r public .next/standalone/apps/web/public

FROM node:24-bookworm-slim AS runner

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

WORKDIR /app

COPY --from=builder /workspace/apps/web/.next/standalone/apps/web/ ./

EXPOSE 3000

CMD ["node", "server.js"]
