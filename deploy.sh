#!/usr/bin/env bash
set -euo pipefail

# MAPro Web Ubuntu 一键部署脚本
# 用法：
#   首次部署： ./deploy.sh
#   更新版本： ./deploy.sh update
#
# 依赖：git、docker、docker compose

REPO_URL="https://github.com/andrewchay/mapro.git"
INSTALL_DIR="${MAPRO_INSTALL_DIR:-/opt/mapro}"
DATA_BACKUP_DIR="${MAPRO_BACKUP_DIR:-/opt/mapro-backups}"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.yml"
ENV_FILE="$INSTALL_DIR/.env"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# 检查命令是否存在
check_command() {
  if ! command -v "$1" &>/dev/null; then
    log_error "缺少依赖：$1"
    echo "请安装 $1 后重试。"
    exit 1
  fi
}

# 生成随机密钥
generate_secret() {
  openssl rand -hex 32
}

# 初始化 .env
ensure_env() {
  if [[ -f "$ENV_FILE" ]]; then
    log_info "检测到已有 .env，保留现有密钥"
    return 0
  fi

  log_info "生成新的安全密钥..."
  local jwt_secret master_key api_token
  jwt_secret=$(generate_secret)
  master_key=$(generate_secret)
  api_token=$(generate_secret)

  cat > "$ENV_FILE" <<EOF
# MAPro Web 生产环境配置
# 由 deploy.sh 自动生成，请勿提交到 Git

MAPRO_JWT_SECRET=$jwt_secret
MAPRO_MASTER_KEY=$master_key
MAPRO_API_TOKEN=$api_token

# 如需跨域，填写你的域名
# MAPRO_ALLOWED_ORIGINS=https://your-domain.com

# Chat 模型配置（按需启用）
# MAPRO_CHAT_PROVIDER=deepseek
# MAPRO_CHAT_API_KEY=sk-xxx
# MAPRO_CHAT_BASE_URL=https://api.deepseek.com
# MAPRO_CHAT_MODEL=deepseek-chat

# Agent 模型配置（按需启用）
# MAPRO_AGENT_PROVIDER=anthropic
# MAPRO_AGENT_API_KEY=sk-ant-xxx
# MAPRO_AGENT_MODEL=claude-sonnet-4-20250514
EOF

  chmod 600 "$ENV_FILE"
  log_info ".env 已创建：$ENV_FILE"
}

# 备份数据卷
backup_data() {
  if [[ ! -d "$INSTALL_DIR" ]]; then
    return 0
  fi

  local backup_name
  backup_name="mapro-data-$(date +%Y%m%d-%H%M%S).tar.gz"
  mkdir -p "$DATA_BACKUP_DIR"

  log_info "备份现有数据到 $DATA_BACKUP_DIR/$backup_name ..."
  if docker compose -f "$COMPOSE_FILE" ps -q 2>/dev/null | grep -q .; then
    log_warn "容器正在运行，先停止再备份"
    docker compose -f "$COMPOSE_FILE" down
  fi

  if docker volume inspect ma-proma_mapro-data &>/dev/null; then
    docker run --rm \
      -v ma-proma_mapro-data:/data \
      -v "$DATA_BACKUP_DIR:/backup" \
      oven/bun:1.3.14 \
      tar czf "/backup/$backup_name" -C /data .
    log_info "备份完成：$DATA_BACKUP_DIR/$backup_name"
  else
    log_info "暂无数据卷，跳过备份"
  fi
}

# 克隆或更新代码
setup_code() {
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    log_info "更新代码到 $INSTALL_DIR ..."
    cd "$INSTALL_DIR"
    git fetch origin
    git reset --hard "origin/${MAPRO_BRANCH:-main}"
  else
    log_info "克隆代码到 $INSTALL_DIR ..."
    git clone --depth 1 --branch "${MAPRO_BRANCH:-main}" "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
}

# 启动服务
start_services() {
  log_info "构建并启动 MAPro Web..."
  cd "$INSTALL_DIR"

  # 加载 .env
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a

  docker compose down 2>/dev/null || true
  docker compose up --build -d
}

# 健康检查
health_check() {
  local retries=30
  local wait_sec=2
  local url="http://localhost:3000/health"

  log_info "等待服务健康检查..."
  for ((i = 1; i <= retries; i++)); do
    if curl -fsS "$url" &>/dev/null; then
      log_info "服务健康检查通过：$url"
      curl -s "$url" | sed 's/^/  /'
      return 0
    fi
    echo "  第 $i/$retries 次重试..."
    sleep "$wait_sec"
  done

  log_error "服务启动失败，请检查日志："
  docker compose -f "$COMPOSE_FILE" logs --tail 50
  return 1
}

# 打印访问信息
print_access_info() {
  local ip
  ip=$(hostname -I | awk '{print $1}')

  echo
  echo "=========================================="
  echo " MAPro Web 部署完成"
  echo "=========================================="
  echo "  HTTP 地址： http://$ip:3000"
  echo "  WebSocket： ws://$ip:8081"
  echo "  数据目录： $INSTALL_DIR"
  echo "  备份目录： $DATA_BACKUP_DIR"
  echo "  环境配置： $ENV_FILE"
  echo
  echo "  首次使用请打开页面创建初始管理员"
  echo
  echo "  常用命令："
  echo "    查看日志： cd $INSTALL_DIR && docker compose logs -f"
  echo "    停止服务： cd $INSTALL_DIR && docker compose down"
  echo "    重启服务： cd $INSTALL_DIR && docker compose restart"
  echo "=========================================="
}

main() {
  local command="${1:-install}"

  check_command git
  check_command docker
  check_command docker-compose || check_command "docker compose" || {
    log_error "需要 Docker Compose v2（docker compose）"
    exit 1
  }

  if [[ "$command" == "update" ]]; then
    backup_data
  fi

  setup_code
  ensure_env

  if [[ "$command" == "install" || "$command" == "update" ]]; then
    start_services
    health_check
    print_access_info
  else
    echo "用法：$0 [install|update]"
    exit 1
  fi
}

main "$@"
