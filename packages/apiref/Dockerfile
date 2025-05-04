#syntax=docker/dockerfile:1.7-labs
FROM node:lts-alpine AS base

FROM base AS builder
WORKDIR /app
COPY package-lock.json* .
COPY --parents **/package.json .
RUN npm install
COPY . .

FROM builder as frontend
ARG SPEC
ARG BASE
WORKDIR /app
ENV VITE_SPEC=${SPEC}
ENV VITE_BASE=${BASE}
RUN ./node_modules/.bin/nx run apiref:build:production

# extract
# FROM base as extract
# WORKDIR /extract
# COPY --from=frontend /app/packages/apiref/dist/client .


# host
# FROM nginxinc/nginx-unprivileged AS start
# WORKDIR /usr/share/nginx/html
# COPY --from=frontend /app/packages/apiref/dist/client .
# ENV PORT=8080
# USER nginx
# EXPOSE 8080
# HEALTHCHECK CMD curl -f http://localhost:8080 || exit 1
# CMD ["nginx", "-g", "daemon off;"]



FROM minio/mc AS deploy

COPY --from=frontend /app/packages/apiref/dist/client /static

ARG BASE
ARG HETZNER_S3_ENDPOINT
ARG HETZNER_ACCESS_KEY
ARG HETZNER_SECRET_KEY
ARG HETZNER_BUCKET
ENV MC_HOST="https://${HETZNER_S3_ENDPOINT}" \
	MC_ACCESS_KEY="${HETZNER_ACCESS_KEY}" \
	MC_SECRET_KEY="${HETZNER_SECRET_KEY}"

# Configure alias and ensure bucket exists
RUN mc alias set hetzner "${MC_HOST}" "${MC_ACCESS_KEY}" "${MC_SECRET_KEY}" --api "s3v4"
RUN mc cp --recursive /static hetzner/${HETZNER_BUCKET}/${BASE}
