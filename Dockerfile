# Single-runtime container: Node runs the TypeScript directly, impers
# impersonates Chrome's TLS/H2 in-process — no browser, no sidecar.
FROM node:26-bookworm-slim

ENV NODE_ENV=production \
    TZ=Europe/London \
    IMPER_CACHE_DIR=/opt/impers-cache

WORKDIR /app

# deps only (playwright-core optional dep is intentionally omitted)
COPY package.json ./
RUN npm install --omit=optional --omit=dev --no-fund --no-audit \
    # npm >=11 blocks lifecycle scripts; koffi needs its prebuild step,
    # so run exactly what `bun pm trust` runs:
 && cd node_modules/koffi && node ./cnoke.cjs -P . -D src/koffi --prebuild --release \
 && cd /app

COPY src/ ./src/

# bake the pinned libcurl-impersonate download into the image + smoke-test it
RUN node -e "import('impers').then(async m => { const s = new m.Session({ impersonate: 'chrome', timeout: 30 }); const r = await s.get('https://example.com'); if (r.status !== 200) throw new Error('smoke failed: ' + r.status); await s.close(); console.log('impers warm-up OK'); })"

RUN useradd -m -u 1000 shopper && mkdir -p /home/shopper/.sainsburys && chown -R shopper /home/shopper /opt/impers-cache
USER shopper
VOLUME ["/home/shopper/.sainsburys"]

ENTRYPOINT ["node", "src/index.ts"]
CMD ["--help"]
