#!/bin/bash
#
# humanizer-ja を複数のMac間で同期するスクリプト
#
# GitHub を中央リポジトリとして、
#   1. ローカル変更があれば自動コミット
#   2. リモートの変更を取り込む（rebase）
#   3. ローカルのコミットを push
# を行います。launchd から定期実行される前提で、オフライン時は静かに終了します。
#
# 使い方:
#   scripts/sync.sh              # 双方向同期（既定）
#   SYNC_PUSH=0 scripts/sync.sh  # pull のみ（このMacからは push しない）
#   SYNC_BRANCH=main             # 同期するブランチ（既定: main）

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${SYNC_BRANCH:-main}"
CONFLICT_MARKER="$REPO_DIR/.git/humanizer-ja-conflict-notified"

cd "$REPO_DIR"

log() { echo "[humanizer-ja sync] $*"; }

notify() {
  # macOS の通知センターに表示（macOS 以外では何もしない）
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$1\" with title \"humanizer-ja 同期\"" >/dev/null 2>&1 || true
  fi
}

host_name() {
  if command -v scutil >/dev/null 2>&1; then
    scutil --get ComputerName 2>/dev/null || hostname
  else
    hostname
  fi
}

# 進行中の rebase/merge が残っていたら手動解決待ちなので触らない
if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] || [ -f .git/MERGE_HEAD ]; then
  log "解決待ちの rebase/merge があるため中断します: cd $REPO_DIR で状態を確認してください"
  exit 1
fi

# オフライン・認証エラーなどで fetch できないときは静かに終了
if ! git fetch origin "$BRANCH" --quiet 2>/dev/null; then
  log "origin に接続できないためスキップします"
  exit 0
fi

# ローカル変更を自動コミット
if [ "${SYNC_PUSH:-1}" = "1" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    git commit --quiet -m "Auto-sync from $(host_name)"
    log "ローカル変更をコミットしました"
  fi
fi

# リモートの変更を取り込む（ローカルのコミットは上に載せ直す）
if ! git rebase --quiet "origin/$BRANCH" 2>/dev/null; then
  git rebase --abort >/dev/null 2>&1 || true
  log "コンフリクトが発生しました。手動で解決してください: cd $REPO_DIR && git pull --rebase origin $BRANCH"
  # 通知は初回だけ（15分ごとに鳴り続けないように）
  if [ ! -f "$CONFLICT_MARKER" ]; then
    notify "コンフリクトが発生しました。ターミナルで手動解決してください"
    touch "$CONFLICT_MARKER"
  fi
  exit 1
fi
rm -f "$CONFLICT_MARKER"

# ローカルのコミットを push
if [ "${SYNC_PUSH:-1}" = "1" ]; then
  if [ -n "$(git log "origin/$BRANCH..HEAD" --oneline 2>/dev/null)" ]; then
    if git push --quiet origin "HEAD:$BRANCH" 2>/dev/null; then
      log "push しました"
    else
      log "push に失敗しました（次回の同期で再試行します）"
    fi
  fi
fi

log "同期完了（$(host_name)）"
