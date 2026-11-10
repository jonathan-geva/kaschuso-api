# syntax=docker/dockerfile:1
FROM node:24-alpine
ENV NODE_ENV=production

WORKDIR /app/kaschuso-api

# SAL authentication uses curl. The optional public CA mount supports managed builds.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then SSL_CERT_FILE=/run/secrets/proxy_ca apk add --no-cache curl; else apk add --no-cache curl; fi

COPY ["package.json", "yarn.lock", "./"]

RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca yarn install --frozen-lockfile --production=true; else yarn install --frozen-lockfile --production=true; fi
COPY . .

EXPOSE 3001
CMD [ "node", "app.js" ]
