# Build único: o front-end (Vite) é compilado e servido pelo próprio backend -> um só deploy / uma só URL.
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend ./
COPY --from=web /web/dist ./public
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "src/index.js"]
