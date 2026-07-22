# syntax=docker/dockerfile:1

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY client ./client
COPY server ./server
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server ./server
COPY --from=build /app/server/public ./server/public
RUN mkdir -p data/runs data/uploads
EXPOSE 8787
CMD ["node", "server/src/index.js"]
