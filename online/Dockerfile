# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Debug: Check what was built
RUN echo "=== Checking build output ===" && \
    ls -la /app/.next/ && \
    echo "=== Checking compiled server.js ===" && \
    head -30 /app/.next/server.js && \
    echo "=== Checking for src in .next ===" && \
    ls -la /app/.next/src/ 2>/dev/null | head -20 || echo "No .next/src in builder" && \
    echo "=== Checking compiled src files ===" && \
    find /app/.next/src -name "*.js" 2>/dev/null | head -10 || echo "No compiled .js files in .next/src" && \
    echo "=== Checking standalone structure ===" && \
    ls -la /app/.next/standalone/ 2>/dev/null || echo "No standalone directory" && \
    echo "=== Checking require statements in server.js ===" && \
    grep -E "require\(['\"].*src" /app/.next/server.js || echo "No src requires found"

# Production stage
FROM node:24-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy package files
COPY package.json package-lock.json ./

# Install only production dependencies
# We'll use our full production deps, not the minimal ones from standalone
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copy built application from builder stage
# IMPORTANT: Copy our custom server.js FIRST before copying standalone's .next
# This ensures our server.js doesn't get overwritten
COPY --from=builder --chown=nextjs:nodejs /app/.next/server.js ./.next/server.js

# Copy standalone output selectively (exclude its node_modules, we use ours)
# Standalone contains: server.js, .next/, node_modules/, package.json
# Copy standalone's .next (this might overwrite our server.js, so we copy it again after)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/.next ./.next

# Copy our server.js again to ensure it's not overwritten by standalone
COPY --from=builder --chown=nextjs:nodejs /app/.next/server.js ./.next/server.js

# Copy static files
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Copy compiled source files - the compiled server.js requires ./src/ relative to .next/server.js
# The TypeScript compiler outputs compiled .js files to .next/src/ during build
# So we need the compiled .next/src/ directory structure
COPY --from=builder --chown=nextjs:nodejs /app/.next/src ./.next/src

# Debug: Verify the final structure
RUN echo "=== Final .next structure ===" && \
    ls -la /app/.next/ && \
    echo "=== Checking for server.js ===" && \
    test -f /app/.next/server.js && echo "server.js exists" || echo "server.js MISSING" && \
    echo "=== Checking for compiled src in .next ===" && \
    ls -la /app/.next/src/ 2>/dev/null | head -15 || echo "No .next/src directory" && \
    echo "=== Checking for gameManager.js ===" && \
    find /app/.next/src -name "gameManager.js" 2>/dev/null && echo "gameManager.js found" || echo "gameManager.js MISSING" && \
    echo "=== Checking require statements in server.js ===" && \
    grep -E "require\(['\"].*src" /app/.next/server.js | head -5 || echo "No src requires found" && \
    echo "=== Sample of gameManager.js content ===" && \
    head -20 /app/.next/src/gameManager.js 2>/dev/null || echo "Cannot read gameManager.js"

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Enable Node.js module debugging
ENV NODE_OPTIONS="--trace-warnings"
ENV NODE_DEBUG=module

# Start the server
# Use npm start which runs .next/server.js (matches package.json script)
CMD ["npm", "run", "start"]
