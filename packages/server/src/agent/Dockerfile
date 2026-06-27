# MAPro Agent SDK 容器镜像
#
# 阶段 B Agent 服务端化的最小隔离单元。
# 镜像本身不包含 SDK binary（222MB，且跨平台），而是通过 volume 挂载宿主/镜像构建时提供的 binary。
# 这样同一镜像可在 linux-x64 / linux-arm64 上复用，只需换挂载的 binary。

FROM debian:bookworm-slim

# 可选：通过 build arg 指定 apt mirror（如 mirrors.aliyun.com）
# 默认保留 Debian 官方源，保证可移植性。
# 使用示例：docker build --build-arg APT_MIRROR=mirrors.aliyun.com ...
ARG APT_MIRROR=
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources && \
      sed -i "s|security.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources; \
    fi

# 安装 SDK binary 可能依赖的基础运行时
# ca-certificates：HTTPS 请求必需
# git：部分 Agent 工作流可能调用 git
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# SDK 可能需要写缓存/配置到 HOME
ENV HOME=/tmp/mapro-agent-home
RUN mkdir -p $HOME

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/claude"]
