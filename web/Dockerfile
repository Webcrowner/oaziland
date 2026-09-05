# Oaziland web app — production Docker image.
#
# WHY this uses TWO stages (builder, then runner), unlike the
# backend's single-stage file: the build stage needs the full
# node_modules, dev dependencies, and source code, but the final
# running container only needs the compiled output. Discarding the
# build stage's leftover files keeps the final image significantly
# smaller — this app's build stage is much heavier than the
# backend's, so the saving is worth the extra file complexity here.

FROM node:20-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# The real, live backend URL is baked in at build time — Next.js
# inlines NEXT_PUBLIC_* variables into the compiled JavaScript, so
# this must be set correctly BEFORE building, not just at container
# startup (unlike the backend, where env vars can change at runtime).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Only the standalone output (see next.config.ts's "output:
# standalone" setting) is copied — this is what makes the final
# image small: no dev dependencies, no source files, no build cache.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
