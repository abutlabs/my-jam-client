# The client as a fuzz target, packaged as the official fuzzer runs targets: a linux/amd64
# image whose entry point is bin/target.ts, set up by JAM_FUZZ_* environment variables.
FROM node:26.11.1-bookworm-slim
WORKDIR /client
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY bin/target.ts ./bin/target.ts
ENTRYPOINT ["node", "bin/target.ts"]
