FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --frozen-lockfile
COPY . .
RUN npm run build
RUN npm install -g serve
EXPOSE 8080
CMD ["serve", "-s", "dist", "-l", "8080"]
