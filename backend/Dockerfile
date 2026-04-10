# Use Node.js 20 LTS
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install runtime tools used by healthchecks
RUN apk add --no-cache curl

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy source code
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY entrypoint.sh ./entrypoint.sh

# Create uploads directory and non-root user
RUN mkdir -p uploads \
    && chmod +x entrypoint.sh \
    && addgroup -S appgroup && adduser -S appuser -G appgroup \
    && chown -R appuser:appgroup /app

USER appuser

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node src/health-check.js

# Start the application
CMD ["sh", "entrypoint.sh"]
