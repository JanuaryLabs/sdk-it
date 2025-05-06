#syntax=docker/dockerfile:1.7-labs
FROM node:lts-alpine AS base

ARG TARGETPLATFORM
ENV TARGETPLATFORM=${TARGETPLATFORM:-linux/amd64}
RUN echo "I am building for $TARGETPLATFORM"

FROM base AS builder
WORKDIR /app
COPY package-lock.json* .
COPY --parents **/package.json .

# Cache .nx directory to speed up builds
RUN --mount=type=cache,target=/root/.npm npm install

COPY . .

FROM builder as frontend
ARG SPEC
ARG BASE
WORKDIR /app
ENV NX_DAEMON=false
ENV NODE_ENV=production
ENV VITE_SPEC=${SPEC}
ENV VITE_BASE=${BASE}
RUN --mount=type=cache,id=nx,target=/app/.nx ./node_modules/.bin/nx run apiref:build:production

FROM peakcom/s5cmd:v2.3.0 AS deploy
WORKDIR /static
COPY --from=frontend /app/packages/apiref/dist/client/ .
RUN ls ./

ARG BASE
ARG HETZNER_S3_ENDPOINT
ARG HETZNER_ACCESS_KEY
ARG HETZNER_SECRET_KEY
ARG HETZNER_BUCKET

# Map to the AWS SDK vars that s5cmd expects
ENV AWS_ACCESS_KEY_ID=${HETZNER_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${HETZNER_SECRET_KEY} \
AWS_REGION=eu-central \
S5CMD_ENDPOINT_URL="https://${HETZNER_S3_ENDPOINT}"

RUN /s5cmd \
    --endpoint-url "$S5CMD_ENDPOINT_URL" \
    cp ./ s3://${HETZNER_BUCKET}/${BASE}/
