FROM node:22-bookworm-slim
WORKDIR /app
COPY public public
COPY shared shared
COPY selfhost selfhost
COPY drizzle drizzle
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=8080 BIND=0.0.0.0 DATA_DIR=/data
EXPOSE 8080
CMD ["node","selfhost/server.mjs"]
