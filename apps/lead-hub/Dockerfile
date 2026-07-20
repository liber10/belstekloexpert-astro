FROM node:22-alpine AS build

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/lead-hub/package.json ./apps/lead-hub/package.json
RUN npm ci --workspace @belstekloexpert/lead-hub

COPY apps/lead-hub ./apps/lead-hub
RUN npm run build --workspace @belstekloexpert/lead-hub

FROM node:22-alpine AS runtime

WORKDIR /workspace

COPY apps/lead-hub/package.json apps/lead-hub/package-lock.json ./apps/lead-hub/
RUN npm ci --prefix apps/lead-hub --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /workspace/apps/lead-hub/dist ./apps/lead-hub/dist
COPY --from=build --chown=node:node /workspace/apps/lead-hub/drizzle ./apps/lead-hub/drizzle

ENV NODE_ENV=production
EXPOSE 8787
USER node

CMD ["node", "apps/lead-hub/dist/index.js"]
