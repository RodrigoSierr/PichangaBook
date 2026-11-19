# =============================================================================
#  PichangaBook Arequipa · Dockerfile Unificado (API + Socket.IO + /admin + /mobile)
#  Optimizado para Render Free Web Service + Neon / Supabase Serverless Postgres
# =============================================================================
FROM node:22-alpine AS builder
WORKDIR /workspace/backend-nestjs
COPY backend-nestjs/package*.json ./
RUN npm install
COPY backend-nestjs/tsconfig*.json backend-nestjs/nest-cli.json ./
COPY backend-nestjs/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /workspace/backend-nestjs
ENV NODE_ENV=production
COPY backend-nestjs/package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /workspace/backend-nestjs/dist ./dist
COPY backend-nestjs/schema.sql backend-nestjs/seed.sql ./
COPY backend-nestjs/migrations ./migrations
COPY backend-nestjs/scripts ./scripts
COPY backend-nestjs/public ./public
COPY web-admin-tailwind/index.html /workspace/web-admin-tailwind/index.html
COPY mobile-flutter/demo-app-mobile.html /workspace/mobile-flutter/demo-app-mobile.html
RUN mkdir -p /workspace/backend-nestjs/private-storage/complex-docs && chown -R node:node /workspace
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
