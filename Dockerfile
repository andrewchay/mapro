# MAPro Web 阶段 A Docker 镜像
# 同时构建后端（apps/web）和前端（apps/web-ui），由后端托管静态资源

FROM oven/bun:1.3.14 AS builder

WORKDIR /app

# 先复制 workspace 清单，利用 Docker 缓存依赖层
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/
COPY apps/web/package.json ./apps/web/
COPY apps/web-ui/package.json ./apps/web-ui/

RUN bun install

# 复制源码并构建
COPY packages/shared ./packages/shared
COPY packages/ui ./packages/ui
COPY packages/core ./packages/core
COPY packages/server ./packages/server
COPY apps/web ./apps/web
COPY apps/web-ui ./apps/web-ui
COPY tsconfig.json ./

RUN bun run --filter='@ma-proma/server' typecheck
RUN bun run --filter='@ma-proma/web' typecheck
RUN bun run --filter='@ma-proma/web-ui' build

# 生产镜像
FROM oven/bun:1.3.14

WORKDIR /app

ENV NODE_ENV=production
ENV MAPRO_DATA_DIR=/app/data
ENV MAPRO_WEB_UI_DIR=/app/web-ui-dist

# 只复制运行所需文件
COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/web ./apps/web
COPY --from=builder /app/apps/web-ui/dist ./web-ui-dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/tsconfig.json ./

RUN mkdir -p /app/data

EXPOSE 3000 8081

CMD ["bun", "run", "--filter=@ma-proma/web", "start"]
