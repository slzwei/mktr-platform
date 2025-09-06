# Use Node.js 18 LTS
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src ./src

ENV PORT=4001
EXPOSE 4001

CMD ["npm", "start"]
