#!/usr/bin/env bash
set -euo pipefail

# Tokens stay in this local shell. Do not commit or paste them into project files.
set +o history 2>/dev/null || true
read -r -s -p '主机器人 Bot Token: ' MAIN_TOKEN
printf '\n'
read -r -s -p '入口机器人 Bot Token: ' ENTRY_TOKEN
printf '\n'
set -o history 2>/dev/null || true

CTX='{"initData":{"user":{"id":8707981004,"first_name":"管理员"}}}'
run_publisher() {
  local token="$1" role="$2"
  if [[ ! "$token" =~ ^[0-9]{5,}:[A-Za-z0-9_-]{20,}$ ]]; then
    echo "Token 格式不正确" >&2
    exit 2
  fi
  pnpm exec tgcloud run endpoints/api \
    "{\"route\":\"/publisher\",\"method\":\"POST\",\"body\":{\"token\":\"$token\",\"role\":\"$role\"}}" \
    --ctx "$CTX"
}

run_publisher "$MAIN_TOKEN" publisher
run_publisher "$ENTRY_TOKEN" entry
unset MAIN_TOKEN ENTRY_TOKEN
echo '两个机器人已写入 Serverless 数据库。'
