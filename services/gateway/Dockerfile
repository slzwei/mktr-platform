# Use Node.js 18 LTS
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src ./src

ENV PORT=4000
EXPOSE 4000

CMD ["npm", "start"]
