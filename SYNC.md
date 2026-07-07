# 複数のMacで完全連携させる（iMac Pro / MacBook Pro）

humanizer-ja を2台以上のMacで使うとき、「どっちのMacで編集した版が最新か分からない」状態を避けるための仕組みです。

## 仕組み

GitHub のこのリポジトリを「中央」として、各Macの `~/.claude/skills/humanizer-ja` が自動で同期します。

```
        GitHub (matsutouya/humanizer-ja)
           ↑ push        ↓ pull
  ┌────────┴─────┐  ┌────┴─────────┐
  │   iMac Pro   │  │ MacBook Pro  │
  │ ~/.claude/   │  │ ~/.claude/   │
  │  skills/     │  │  skills/     │
  └──────────────┘  └──────────────┘
```

- **スキル本体**（SKILL.md・テンプレートなど）→ **Git で同期**。launchd がログイン時と15分ごとに `scripts/sync.sh` を実行し、pull / 自動コミット / push まで行います。
- **個人の書き手プロファイル**（`profiles/` と `writer-profile-*.md`）→ 公開リポジトリには載せず、**iCloud Drive で同期**（オプション）。

どちらのMacで SKILL.md やプロファイルを編集しても、15分以内にもう一方へ反映されます。

## 前提

- 両方のMacに git がインストールされていること（Xcode Command Line Tools で入ります）
- push するために GitHub の認証が済んでいること（SSHキー、または `gh auth login` などの credential helper）。認証がない場合も pull（受信）だけは動きます。

## セットアップ

**iMac Pro と MacBook Pro のそれぞれで、1回ずつ**以下を実行します。

```bash
# まだ clone していないMacでも、この1行だけでOK（配置 + 自動同期の登録まで行われます）
curl -fsSL https://raw.githubusercontent.com/matsutouya/humanizer-ja/main/scripts/setup-mac.sh | bash
```

すでに clone 済みのMacなら、リポジトリ内で実行しても同じです：

```bash
bash ~/.claude/skills/humanizer-ja/scripts/setup-mac.sh
```

書き手プロファイルも iCloud で同期したい場合は：

```bash
bash ~/.claude/skills/humanizer-ja/scripts/setup-mac.sh --icloud-profiles
```

これで `~/.claude/skills/humanizer-ja/profiles/` が iCloud Drive（`humanizer-ja-profiles` フォルダ）への symlink になり、`writer-profile-business.md` などの個人プロファイルが2台のMacで共有されます。

## 日常の使い方

**何もしなくていい**、が基本です。

- どちらのMacでも Claude Code から `/humanizer-ja` を呼ぶだけ
- SKILL.md やプロファイルを編集したら、15分以内に自動でもう一方のMacへ反映
- 今すぐ同期したいときだけ手動で：

```bash
bash ~/.claude/skills/humanizer-ja/scripts/sync.sh
```

- このMacからは push したくない（受信専用にしたい）場合：

```bash
SYNC_PUSH=0 bash ~/.claude/skills/humanizer-ja/scripts/sync.sh
```

## コンフリクトが起きたら

2台で同じ箇所を同時に編集した場合、自動同期は安全のため停止し、macOS の通知でお知らせします。次のように手動で解決してください：

```bash
cd ~/.claude/skills/humanizer-ja
git pull --rebase origin main
# コンフリクト箇所を編集して
git add -A && git rebase --continue
git push origin main
```

解決後は自動同期が自動的に再開します。

## 状態の確認・解除

```bash
# 同期ログを見る
tail -f ~/Library/Logs/humanizer-ja-sync.log

# 自動同期を解除する（ファイルは残ります）
bash ~/.claude/skills/humanizer-ja/scripts/setup-mac.sh --uninstall
```

## 補足

- 同期間隔は `SYNC_INTERVAL=300 bash scripts/setup-mac.sh` のように秒単位で変えられます（既定は900秒 = 15分）
- OpenCode（`~/.config/opencode/skills`）でも使う場合は、clone を増やすより `ln -s ~/.claude/skills/humanizer-ja ~/.config/opencode/skills/humanizer-ja` と symlink にしておくと、同期が1か所で済みます
- `profiles/` と `writer-profile-*.md` は `.gitignore` 済みなので、個人プロファイルが公開リポジトリへ誤って push されることはありません
