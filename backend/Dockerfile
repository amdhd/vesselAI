FROM node:24.21.0-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npx prisma generate

EXPOSE 3001

CMD ["npm", "run", "dev"]
