# ── Stage 1: Build ──────────────────────────────────────────
FROM node:22-slim AS build

WORKDIR /app

# Install openssl so Prisma detects correct engine binary target
RUN apt-get update && apt-get install -y --no-install-recommends openssl && \
    rm -rf /var/lib/apt/lists/*

# Install all dependencies (including dev for prisma CLI + typescript)
COPY .npmrc package.json package-lock.json* ./
RUN npm ci

# Generate Prisma client (openssl present → correct debian-openssl-3.0.x engine)
COPY prisma ./prisma
RUN npx prisma generate

# Verify the correct engine was generated
RUN ls -la node_modules/.prisma/client/libquery_engine-*.so.node

# Copy source and compile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY server.ts ./
RUN npm run build

# Copy admin HTML into expected runtime path
RUN mkdir -p dist/src/admin && cp src/admin/index.html dist/src/admin/

# ── Stage 2: Production ────────────────────────────────────
FROM node:22-slim AS production

WORKDIR /app

# Install runtime dependencies (openssl for Prisma, tini for signals, wget for healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl tini wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Verify openssl is installed correctly
RUN ls -la /usr/lib/x86_64-linux-gnu/libssl.so* /lib/x86_64-linux-gnu/libssl.so*

# Non-root user
RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -s /bin/false appuser

# Copy entire node_modules from build (includes correct Prisma engine binary)
COPY --from=build /app/node_modules ./node_modules

# Copy Prisma schema
COPY prisma ./prisma

# Copy compiled output from build stage
COPY --from=build /app/dist ./dist

# Create uploads directory for local storage fallback
RUN mkdir -p /app/uploads && chown -R appuser:appgroup /app/uploads

# Set ownership
RUN chown -R appuser:appgroup /app

USER appuser

# Expose API port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

# Start the application with tini for proper signal handling
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server.js"]
