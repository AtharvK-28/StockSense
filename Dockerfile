# StockSense — one container serving the API and the built web app on port 4000.
# Use with docker-compose.yml, which adds PostgreSQL.

FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npx prisma generate --schema server/prisma/schema.prisma && npm run build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
# The Prisma CLI and tsx (dev dependencies) are kept so the container can migrate and seed on start.
COPY --from=build /app /app
WORKDIR /app/server
EXPOSE 4000
# Apply migrations, load demo data on first start (the seed skips if data exists), then serve.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && node dist/index.js"]
