FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN apk add --no-cache ffmpeg

RUN npm ci --omit=dev

COPY server.js ./

RUN mkdir -p tmp_audio

EXPOSE 3000

CMD ["node", "server.js"]
