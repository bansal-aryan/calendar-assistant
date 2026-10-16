FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc --noEmit
ENV NODE_ENV=production DATA_DIR=/data
CMD ["npm", "run", "start:production"]
