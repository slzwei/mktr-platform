# Use Node.js 20 Alpine
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy source code
COPY src/ ./src/
COPY simulate_device.js ./

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
