#!/usr/bin/env bash
# 云端部署：安装依赖 → 构建 → 执行数据库迁移 → 重启 API。
# 用法（在仓库根目录）：bash scripts/deploy-cloud.sh
#
# 关键点：数据库迁移目标必须与 API 运行时一致，
# 优先从 packages/api-gateway/.env 读取 DATABASE_URL（也兼容外部已导出的值），再执行 prisma migrate deploy。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[deploy] install dependencies"
pnpm install

echo "[deploy] build"
pnpm build

echo "[deploy] database migrations"
if [ -f packages/api-gateway/.env ]; then
  set -a
  # shellcheck disable=SC1091
  source packages/api-gateway/.env
  set +a
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[deploy] ERROR: DATABASE_URL 未设置（检查 packages/api-gateway/.env）" >&2
  exit 1
fi
pnpm db:deploy

echo "[deploy] restart api"
pm2 startOrRestart packages/api-gateway/ecosystem.config.cjs
pm2 save || true

echo "[deploy] done"
