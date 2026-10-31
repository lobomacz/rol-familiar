FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV SQLITE_PATH=/app/data/rol-familiar.sqlite
EXPOSE 5174
CMD ["npm", "run", "dev"]
