# Fable Voice

Aqua Voice を使わずに、**Whisper (ローカルSTT) + Claude Fable 5** で同等以上の音声入力を実現するツール。

```
🎙 録音 (Enterトグル) → 📝 Whisperで書き起こし → ✨ Fableで整形 → 📋 クリップボード/自動ペースト
```

## Aqua Voice を超えるポイント

- **カスタム整形スタイル**: `--style` で「議事録」「Slack投稿」「PR説明文」など用途別のプロンプトを切り替え。`STYLES` 辞書に追加するだけで自分専用モードを何個でも作れる
- **日本語特化**: Whisper large-v3-turbo + Fable の組み合わせで、フィラー除去・句読点・言い直しの整理が自然
- **完全ローカルSTT**: Apple Silicon なら mlx-whisper で音声がマシンから出ない（LLM整形部分のみAPI）
- **サブスク不要**: API従量課金のみ

## セットアップ (macOS / Apple Silicon)

```bash
git clone https://github.com/matsutouya/humanizer-ja.git
cd humanizer-ja/voice

python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export ANTHROPIC_API_KEY=sk-ant-...   # または `ant auth login` 済みなら不要
```

初回実行時に mlx-whisper がモデル (~1.5GB) をダウンロードします。

## 使い方

```bash
python fable_voice.py                  # 整形モード。Enterで録音開始/停止
python fable_voice.py --style minutes  # 議事録モード
python fable_voice.py --style slack    # Slack投稿モード
python fable_voice.py --style pr       # PR説明文モード
python fable_voice.py --style raw      # 整形なし(STTのみ)
python fable_voice.py --paste          # 整形後にアクティブなアプリへ自動ペースト
```

整形結果は常にクリップボードに入るので、そのまま `Cmd+V` で貼り付けられます。

### `--paste` (自動ペースト) を使う場合

macOSのアクセシビリティ許可が必要です:
**システム設定 → プライバシーとセキュリティ → アクセシビリティ** で、実行しているターミナルアプリ (Terminal / iTerm2 等) を許可してください。

### マイク許可

初回録音時にマイクへのアクセス許可を求められるので許可してください。

## STTバックエンド

| バックエンド | 条件 | 特徴 |
|---|---|---|
| mlx-whisper (デフォルト) | Apple Silicon | ローカル・無料・音声が外に出ない |
| OpenAI Whisper API | `OPENAI_API_KEY` 設定 + `pip install openai` | Intel Mac でも動く |

mlx-whisper がインストールされていればそちらが優先されます。

## モデル

デフォルトは `claude-fable-5`(`--model` で変更可)。整形は `effort: low` で実行するためレイテンシは短めです。より安く速くしたい場合:

```bash
python fable_voice.py --model claude-haiku-4-5
```

※ Haiku等に切り替える場合、Fable専用のフォールバック設定はそのままでも無害ですが、気になる場合は `refine()` を `client.messages.create` に簡略化できます。
