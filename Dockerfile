# Use a lightweight Node image with Puppeteer dependencies pre-installed
FROM ghcr.io/puppeteer/puppeteer:21.5.0

USER root

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy app source
COPY . .

# Build TypeScript
RUN npm run build

# Expose backend port
EXPOSE 5000

# Run in production mode
ENV NODE_ENV=production
ENV PORT=5000
ENV WWEBJS_AUTH_PATH=/tmp/.wwebjs_auth
ENV WWEBJS_CACHE_PATH=/tmp/.wwebjs_cache
ENV WHATSAPP_PROVIDER=local
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Writable ephemeral dirs for LocalAuth + web version cache (Render Free — no persistent disk)
RUN mkdir -p /tmp/.wwebjs_auth /tmp/.wwebjs_cache && chmod -R 777 /tmp/.wwebjs_auth /tmp/.wwebjs_cache

# Start command
CMD [ "npm", "start" ]
