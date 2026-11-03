FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=8080

COPY package.json ./
COPY server ./server
COPY lib ./lib
COPY site ./site

RUN mkdir -p /data
VOLUME /data
EXPOSE 8080

CMD ["node", "--experimental-sqlite", "server/index.js"]
