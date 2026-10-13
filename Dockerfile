# Imagem para rodar em servidor/nuvem. Os dados ficam no volume /app/data.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
ENV NODE_ENV=production TZ=America/Fortaleza PORT=3000 DATA_DIR=/app/data
RUN apk add --no-cache tzdata
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "--no-warnings", "server/index.js"]
