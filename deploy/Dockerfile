# Builds the app and the gateway, then ships one static binary in scratch.
# Build from the repository root: docker build -f deploy/Dockerfile -t haken .
FROM node:22-bookworm AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN make build

FROM golang:1.24-bookworm AS gateway
WORKDIR /src
COPY gateway/ gateway/
COPY --from=web /src/dist/web/ gateway/cmd/haken/dist/
RUN cd gateway && CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags="-s -w" -o /haken ./cmd/haken

FROM scratch
COPY --from=gateway /haken /haken
USER 65534:65534
EXPOSE 8080
ENTRYPOINT ["/haken"]
