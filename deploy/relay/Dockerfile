# Relay cego (Fase 22, T-22.18). NUNCA implantado por este repositório: o dono constrói na própria VPS.
# Estágio 1: compila só o relay (tsconfig.relay.json). Estágio 2: runtime sem shell, não-root, fixado por digest.
# PENDÊNCIA DO DONO (P-360): troque TAMBÉM este digest pelo real (docker buildx imagetools inspect node:22-slim); todo FROM e toda imagem do compose tem de ter digest (A-10).
FROM node:22-slim@sha256:0000000000000000000000000000000000000000000000000000000000000000 AS build
WORKDIR /src
COPY tsconfig.json tsconfig.relay.json ./
COPY src/nucleo/relay ./src/nucleo/relay
COPY src/compartilhado/relay.ts ./src/compartilhado/relay.ts
COPY src/nucleo/produto.ts ./src/nucleo/produto.ts
# versão EXATA do compilador e sem scripts de instalação: nada flutuante no build do relay (A-10)
RUN npx --yes --ignore-scripts --package=typescript@5.9.3 tsc -p tsconfig.relay.json

# PENDÊNCIA DO DONO: substitua o digest abaixo pelo real (docker buildx imagetools inspect gcr.io/distroless/nodejs22:nonroot) antes do primeiro build.
FROM gcr.io/distroless/nodejs22@sha256:0000000000000000000000000000000000000000000000000000000000000000
WORKDIR /app
COPY --from=build /src/dist-relay ./dist
USER 65532:65532
ENV RELAY_BIND=0.0.0.0
ENV RELAY_PORTA=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["/nodejs/bin/node", "-e", "require('http').get('http://127.0.0.1:8080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
ENTRYPOINT ["/nodejs/bin/node", "dist/nucleo/relay/main.js"]
