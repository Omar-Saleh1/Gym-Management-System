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

# Start command
CMD [ "npm", "start" ]
