FROM node:20-alpine
ENV NODE_ENV=production

WORKDIR /app/kaschuso-api

COPY ["package.json", "yarn.lock", "./"]

RUN yarn install --frozen-lockfile --production=true
COPY . .

EXPOSE 3001
CMD [ "node", "app.js" ]