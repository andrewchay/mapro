#!/usr/bin/env bash
set -euo pipefail

# MAPro Web HTTPS 一键配置脚本（Caddy）
# 用法：
#   sudo ./scripts/setup-https.sh your-domain.com
#
# 依赖：Ubuntu/Debian、systemd、MAPro Web 已在本地 3000 端口运行

DOMAIN="${1:-}"
INSTALL_DIR="${MAPRO_INSTALL_DIR:-/opt/mapro}"
CADDYFILE="/etc/caddy/Caddyfile"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

if [[ -z "$DOMAIN" ]]; then
  log_error "缺少域名参数"
  echo "用法：$0 <your-domain.com>"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  log_error "请使用 sudo 运行"
  exit 1
fi

# 安装 Caddy
install_caddy() {
  if command -v caddy &>/dev/null; then
    log_info "Caddy 已安装"
    return 0
  fi

  log_info "安装 Caddy..."
  apt-get update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
}

# 生成 Caddyfile
write_caddyfile() {
  log_info "写入 Caddyfile：$CADDYFILE"
  cat > "$CADDYFILE" <<EOF
$DOMAIN {
    tls {
        protocols tls1.2 tls1.3
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    reverse_proxy localhost:3000 {
        header_up X-Forwarded-Host {host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Real-IP {remote}
    }
}
EOF

  # 验证 Caddyfile 语法
  caddy validate --adapter caddyfile --config "$CADDYFILE"
}

# 更新 MAPro .env
configure_mapro_env() {
  local env_file="$INSTALL_DIR/.env"
  if [[ ! -f "$env_file" ]]; then
    log_warn "未找到 $env_file，跳过自动配置 MAPRO_TRUST_PROXY 与 MAPRO_ALLOWED_ORIGINS"
    return 0
  fi

  log_info "更新 MAPro 环境变量：$env_file"

  # 去旧值，加新值
  grep -v '^MAPRO_TRUST_PROXY=' "$env_file" | grep -v '^MAPRO_ALLOWED_ORIGINS=' > "$env_file.tmp" || true
  {
    echo "MAPRO_TRUST_PROXY=1"
    echo "MAPRO_ALLOWED_ORIGINS=https://$DOMAIN"
  } >> "$env_file.tmp"
  mv "$env_file.tmp" "$env_file"
  chmod 600 "$env_file"
}

# 启动 Caddy
start_caddy() {
  log_info "启动 Caddy..."
  systemctl enable caddy
  systemctl restart caddy
  systemctl status caddy --no-pager
}

# 检查 80/443 端口
wait_for_ports() {
  log_info "检查域名解析与端口可达性..."
  local public_ip
  public_ip=$(curl -fsS https://api.ipify.org 2>/dev/null || echo "未知")
  echo "  服务器公网 IP：$public_ip"
  echo "  请确保域名 $DOMAIN 已解析到上述 IP，且防火墙放行 80/443"
}

main() {
  install_caddy
  wait_for_ports
  write_caddyfile
  configure_mapro_env
  start_caddy

  echo
  echo "=========================================="
  echo " HTTPS 配置完成"
  echo "=========================================="
  echo "  访问地址：https://$DOMAIN"
  echo "  Caddyfile：$CADDYFILE"
  echo "  日志查看：journalctl -u caddy -f"
  echo
  echo "  如 MAPro 正在运行，请重启以加载新环境变量："
  echo "    cd $INSTALL_DIR && docker compose restart"
  echo "=========================================="
}

main
