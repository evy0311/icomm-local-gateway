FROM node:22-bullseye-slim@sha256:5736e7ef1f3f2109be7ef8aea0cbdf931804aee9a18c6760507b8ded078b25a9 AS node
RUN mkdir /runtime-libs && cp /usr/lib/*/libstdc++.so.6 /lib/*/libgcc_s.so.1 /runtime-libs/
FROM httpd:2.4.57-bullseye@sha256:4bdb49b01ab1a7b019410337588f772eebe6ae01d038987aa849fcb798fbf26f
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=node /runtime-libs/ /usr/local/lib/
ENV LD_LIBRARY_PATH=/usr/local/lib
WORKDIR /app
COPY generated/package.json generated/package-lock.json ./
RUN node /usr/local/lib/node_modules/npm/bin/npm-cli.js ci --omit=dev --ignore-scripts \
 && node /usr/local/lib/node_modules/npm/bin/npm-cli.js cache clean --force
COPY generated/src ./src
COPY generated/LICENSE generated/NOTICE ./
COPY generated/apache.conf /app/apache.conf
COPY generated/scripts/openssl.cnf /app/openssl.cnf
COPY options.mjs entrypoint.mjs ./
LABEL io.hass.name="iCOMM Local Gateway" io.hass.type="addon" io.hass.version="0.1.0"
CMD ["node", "/app/entrypoint.mjs"]
