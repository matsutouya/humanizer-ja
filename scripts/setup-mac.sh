#!/bin/bash
#
# humanizer-ja を各Macにセットアップするスクリプト
#
# iMac Pro / MacBook Pro それぞれで1回ずつ実行すると、
#   1. ~/.claude/skills/humanizer-ja にスキルを配置（clone または既存を更新）
#   2. launchd に自動同期エージェントを登録（ログイン時 + 15分ごとに scripts/sync.sh を実行）
#   3. --icloud-profiles を付けた場合、書き手プロファイル（profiles/）を iCloud Drive 経由で同期
# まで行います。以降は何もしなくても2台のMacが同じ状態に保たれます。
#
# 使い方:
#   bash scripts/setup-mac.sh                     # スキル配置 + 自動同期の登録
#   bash scripts/setup-mac.sh --icloud-profiles   # 上に加えて profiles/ を iCloud で同期
#   bash scripts/setup-mac.sh --uninstall         # 自動同期の解除（ファイルは残す）
#
# 環境変数:
#   SYNC_INTERVAL=900   同期間隔（秒、既定: 900 = 15分）

set -euo pipefail

REPO_URL="https://github.com/matsutouya/humanizer-ja.git"
SKILL_DIR="$HOME/.claude/skills/humanizer-ja"
AGENT_LABEL="com.humanizer-ja.sync"
PLIST_PATH="$HOME/Library/LaunchAgents/$AGENT_LABEL.plist"
LOG_PATH="$HOME/Library/Logs/humanizer-ja-sync.log"
ICLOUD_PROFILE_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/humanizer-ja-profiles"
INTERVAL="${SYNC_INTERVAL:-900}"

log() { echo "[humanizer-ja setup] $*"; }

# --- アンインストール -------------------------------------------------------
if [ "${1:-}" = "--uninstall" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm -f "$PLIST_PATH"
  log "自動同期を解除しました（$SKILL_DIR のファイルはそのまま残っています）"
  exit 0
fi

# --- 1. スキルの配置 ---------------------------------------------------------
if [ -d "$SKILL_DIR/.git" ]; then
  log "既存のスキルを更新します: $SKILL_DIR"
  git -C "$SKILL_DIR" pull --rebase origin main || {
    log "更新に失敗しました。$SKILL_DIR の状態を確認してください"
    exit 1
  }
else
  mkdir -p "$(dirname "$SKILL_DIR")"
  log "スキルを配置します: $SKILL_DIR"
  git clone "$REPO_URL" "$SKILL_DIR"
fi

chmod +x "$SKILL_DIR/scripts/sync.sh" "$SKILL_DIR/scripts/setup-mac.sh"

# --- 2. launchd 自動同期の登録 -----------------------------------------------
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$AGENT_LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>$SKILL_DIR/scripts/sync.sh</string>
	</array>
	<key>StartInterval</key>
	<integer>$INTERVAL</integer>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardOutPath</key>
	<string>$LOG_PATH</string>
	<key>StandardErrorPath</key>
	<string>$LOG_PATH</string>
</dict>
</plist>
PLIST

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"
log "自動同期を登録しました（${INTERVAL}秒ごと + ログイン時、ログ: $LOG_PATH）"

# --- 3. 書き手プロファイルの iCloud 同期（オプション） ------------------------
if [ "${1:-}" = "--icloud-profiles" ]; then
  if [ ! -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" ]; then
    log "iCloud Drive が見つかりません。システム設定で iCloud Drive を有効にしてから再実行してください"
    exit 1
  fi
  mkdir -p "$ICLOUD_PROFILE_DIR"
  if [ -d "$SKILL_DIR/profiles" ] && [ ! -L "$SKILL_DIR/profiles" ]; then
    # 既存のローカルプロファイルを iCloud 側へ移してから symlink に置き換える
    cp -n "$SKILL_DIR/profiles/"* "$ICLOUD_PROFILE_DIR/" 2>/dev/null || true
    rm -rf "$SKILL_DIR/profiles"
  fi
  if [ ! -e "$SKILL_DIR/profiles" ]; then
    ln -s "$ICLOUD_PROFILE_DIR" "$SKILL_DIR/profiles"
  fi
  log "書き手プロファイルを iCloud Drive 経由で同期します: $ICLOUD_PROFILE_DIR"
fi

log "セットアップ完了。Claude Code から /humanizer-ja で呼び出せます"
