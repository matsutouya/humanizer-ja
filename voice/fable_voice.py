#!/usr/bin/env python3
"""Fable Voice — Aqua Voice の代替となる音声入力ツール。

録音 → Whisper (ローカルSTT) → Claude Fable 5 で整形 → クリップボード/ペースト

使い方:
    python fable_voice.py                 # デフォルト(整形モード)で起動
    python fable_voice.py --style minutes # 議事録モード
    python fable_voice.py --paste         # 整形後にアクティブなアプリへ自動ペースト

Enterで録音開始、もう一度Enterで停止 → 整形結果がクリップボードに入る。
Ctrl+C で終了。
"""

import argparse
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np
import sounddevice as sd
from anthropic import Anthropic

SAMPLE_RATE = 16000
DEFAULT_MODEL = "claude-fable-5"
FALLBACK_MODEL = "claude-opus-4-8"
WHISPER_REPO = "mlx-community/whisper-large-v3-turbo"

# ここが Aqua Voice を超えるポイント: 整形スタイルを自由に定義できる
STYLES = {
    "default": (
        "話し言葉の書き起こしを、自然な書き言葉に整形してください。"
        "フィラー（えー、あの、まあ等）と言い直しを除去し、句読点を補い、"
        "意味は一切変えないでください。整形後のテキストのみを出力してください。"
    ),
    "minutes": (
        "話し言葉の書き起こしを、議事録の1項目として整形してください。"
        "簡潔な箇条書き（Markdown）にまとめ、決定事項とTODOがあれば明示してください。"
        "整形後のテキストのみを出力してください。"
    ),
    "slack": (
        "話し言葉の書き起こしを、Slackに投稿する自然なメッセージに整形してください。"
        "口語のカジュアルさは残しつつ、フィラーを除去して読みやすくしてください。"
        "整形後のテキストのみを出力してください。"
    ),
    "pr": (
        "話し言葉の書き起こしを、GitHubのPR説明文またはコミットメッセージ本文として"
        "整形してください。変更内容・理由が伝わる簡潔な技術文書にしてください。"
        "整形後のテキストのみを出力してください。"
    ),
    "raw": None,  # 整形なし（STT結果をそのまま使う）
}


def record() -> np.ndarray:
    """Enterで開始/停止するトグル録音。"""
    input("🎙  Enterで録音開始...")
    chunks: list[np.ndarray] = []

    def callback(indata, frames, time, status):
        chunks.append(indata.copy())

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", callback=callback):
        input("🔴 録音中... Enterで停止")

    if not chunks:
        return np.zeros((0, 1), dtype="int16")
    return np.concatenate(chunks)


def save_wav(audio: np.ndarray, path: str) -> None:
    with wave.open(path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE)
        f.writeframes(audio.tobytes())


def transcribe(wav_path: str) -> str:
    """ローカルWhisper(MLX)を優先、なければOpenAI APIにフォールバック。"""
    try:
        import mlx_whisper

        result = mlx_whisper.transcribe(wav_path, path_or_hf_repo=WHISPER_REPO, language="ja")
        return result["text"].strip()
    except ImportError:
        pass

    if os.environ.get("OPENAI_API_KEY"):
        from openai import OpenAI

        client = OpenAI()
        with open(wav_path, "rb") as f:
            result = client.audio.transcriptions.create(model="whisper-1", file=f, language="ja")
        return result.text.strip()

    sys.exit(
        "STTバックエンドがありません。`pip install mlx-whisper`（Apple Silicon推奨）"
        "または OPENAI_API_KEY を設定してください。"
    )


def refine(client: Anthropic, text: str, style: str, model: str) -> str:
    system = STYLES[style]
    if system is None:
        return text

    response = client.beta.messages.create(
        model=model,
        max_tokens=4096,
        output_config={"effort": "low"},  # ディクテーション用途はレイテンシ優先
        # Fable 5 の安全分類器が誤検知した場合に備え、同一リクエスト内で
        # Opus 4.8 に自動フォールバックする(通常は発動しない)
        betas=["server-side-fallback-2026-06-01"],
        fallbacks=[{"model": FALLBACK_MODEL}],
        system=system,
        messages=[{"role": "user", "content": text}],
    )
    if response.stop_reason == "refusal":
        # フォールバック込みで拒否された場合はSTT結果をそのまま返す
        return text
    return "".join(b.text for b in response.content if b.type == "text").strip()


def deliver(text: str, auto_paste: bool) -> None:
    subprocess.run(["pbcopy"], input=text.encode(), check=True)
    if auto_paste:
        subprocess.run(
            [
                "osascript",
                "-e",
                'tell application "System Events" to keystroke "v" using command down',
            ],
            check=True,
        )
        print("📋 ペーストしました")
    else:
        print("📋 クリップボードにコピーしました (Cmd+V で貼り付け)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Fable Voice — 音声入力ツール")
    parser.add_argument("--style", choices=STYLES.keys(), default="default")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--paste", action="store_true", help="整形後にCmd+Vで自動ペースト")
    args = parser.parse_args()

    client = Anthropic()  # ANTHROPIC_API_KEY または `ant auth login` のプロファイルを使用
    print(f"Fable Voice 起動 (style={args.style}, model={args.model})  Ctrl+Cで終了")

    while True:
        try:
            audio = record()
        except KeyboardInterrupt:
            print("\n終了します")
            return

        if len(audio) < SAMPLE_RATE // 2:
            print("⚠️  録音が短すぎます。やり直してください。")
            continue

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            save_wav(audio, tmp.name)
            wav_path = tmp.name

        try:
            raw = transcribe(wav_path)
            if not raw:
                print("⚠️  音声を認識できませんでした。")
                continue
            print(f"📝 認識: {raw}")

            refined = refine(client, raw, args.style, args.model)
            print(f"✨ 整形: {refined}")
            deliver(refined, args.paste)
        finally:
            os.unlink(wav_path)


if __name__ == "__main__":
    main()
