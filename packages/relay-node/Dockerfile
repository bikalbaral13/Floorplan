# Build from the packages/ folder (the server imports the shared Room from relay-do/src):
#   docker build -f relay-node/Dockerfile -t bpluss-relay packages
#   docker run -p 8787:8787 -e RELAY_DO_SECRET=... -v bpluss-relay-data:/data bpluss-relay
FROM node:22-alpine
WORKDIR /app
COPY relay-do/src ./relay-do/src
COPY relay-node/package.json relay-node/server.mjs ./relay-node/
RUN cd relay-node && npm install --omit=dev --no-audit --no-fund
ENV PORT=8787 RELAY_DATA_DIR=/data NODE_ENV=production
VOLUME ["/data"]
EXPOSE 8787
WORKDIR /app/relay-node
CMD ["node", "server.mjs"]
