FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
ENV PORT=4002
EXPOSE 4002
CMD ["node","src/server.js"]


