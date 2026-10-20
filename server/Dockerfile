FROM node:24-bookworm-slim
ENV NODE_ENV=production
ENV PORT=8787
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs ./
RUN mkdir -p /data/reeditx-jobs /tmp/reeditx-uploads && chown -R node:node /data /tmp/reeditx-uploads /app
USER node
EXPOSE 8787
CMD ["node", "index.mjs"]
