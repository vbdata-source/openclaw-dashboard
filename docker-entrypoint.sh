#!/bin/sh
set -e

# Fix permissions on data directory (needed for volume mounts)
# This runs as root before switching to node user
if [ -d /app/data ]; then
  chown -R node:node /app/data 2>/dev/null || true
fi

# Create data directory if it doesn't exist
mkdir -p /app/data/results
chown -R node:node /app/data

# Switch to node user and run the server
exec su-exec node node index.js
