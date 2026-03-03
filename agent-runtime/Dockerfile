FROM node:20-alpine

# Install bash for the bash tool
RUN apk add --no-cache bash curl git

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

WORKDIR /workspace

EXPOSE 8080

CMD ["node", "/app/dist/index.js"]
