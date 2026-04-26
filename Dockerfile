# ---- build stage ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

ENV HUSKY=0
ENV CI=true

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

RUN apt-get update && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

ARG VITE_PUBLIC_APP_URL
ENV VITE_PUBLIC_APP_URL=${VITE_PUBLIC_APP_URL}

COPY package.json pnpm-lock.yaml* ./
RUN pnpm fetch

COPY . .

RUN pnpm install --offline --frozen-lockfile

RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm run build


# ---- production dependencies stage ----
FROM build AS prod-deps

RUN pnpm prune --prod --ignore-scripts


# ---- production stage ----
FROM prod-deps AS bolt-ai-production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5173
ENV HOST=0.0.0.0
ENV WRANGLER_SEND_METRICS=false
ENV RUNNING_IN_DOCKER=true

ARG VITE_LOG_LEVEL=warn
ARG DEFAULT_NUM_CTX=32768

ENV VITE_LOG_LEVEL=${VITE_LOG_LEVEL}
ENV DEFAULT_NUM_CTX=${DEFAULT_NUM_CTX}

RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

# Install Wrangler globally because dockerstart requires the "wrangler" binary at runtime.
# This avoids pnpm prune removing it from node_modules.
RUN npm install -g wrangler@3.114.14

COPY --from=prod-deps /app/build /app/build
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/package.json /app/package.json
COPY --from=prod-deps /app/bindings.sh /app/bindings.sh

RUN mkdir -p /root/.config/.wrangler && \
    echo '{"enabled":false}' > /root/.config/.wrangler/metrics.json

RUN chmod +x /app/bindings.sh

EXPOSE 5173

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD curl -fsS http://localhost:5173/ || exit 1

CMD ["pnpm", "run", "dockerstart"]


# ---- development stage ----
FROM build AS development

ARG VITE_LOG_LEVEL=debug
ARG DEFAULT_NUM_CTX=32768

ENV VITE_LOG_LEVEL=${VITE_LOG_LEVEL}
ENV DEFAULT_NUM_CTX=${DEFAULT_NUM_CTX}
ENV RUNNING_IN_DOCKER=true

RUN mkdir -p /app/run

CMD ["pnpm", "run", "dev", "--host", "0.0.0.0"]
