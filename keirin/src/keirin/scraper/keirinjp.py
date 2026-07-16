"""KEIRIN.JP 出走表・結果スクレイパーの骨組み。

!!! 使用前に必ず KEIRIN.JP の利用規約を確認すること。
    商用利用は公式データ提供契約を検討すること。

- レート制限をハードコードで強制 (MIN_INTERVAL 秒未満の連続リクエスト不可)
- HTML 構造は変わり得るので、パース部分はページ実物を見て
  TODO のセレクタを調整する前提の骨組みにしてある

依存: pip install requests beautifulsoup4
"""

from __future__ import annotations

import time

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://keirin.jp"
MIN_INTERVAL = 3.0  # 秒。サーバ負荷への配慮として3秒未満に縮めないこと
USER_AGENT = "keirin-lab/0.1 (research; contact: TODO@example.com)"  # TODO: 連絡先を設定

_last_request_at = 0.0


def _get(url: str) -> str:
    """レート制限付き GET。"""
    global _last_request_at
    wait = MIN_INTERVAL - (time.monotonic() - _last_request_at)
    if wait > 0:
        time.sleep(wait)
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    _last_request_at = time.monotonic()
    resp.raise_for_status()
    return resp.text


def fetch_race_card(date: str, velodrome_code: str, race_no: int) -> dict:
    """出走表を取得してパースする。

    Returns: {"race": {...}, "entries": [{...}, ...]} — db.py のスキーマに対応。
    """
    # TODO: 実際の出走表URLパターンに合わせる (開催日・場コード・レース番号)
    url = f"{BASE_URL}/pc/racedetail?date={date}&jo={velodrome_code}&race={race_no}"
    soup = BeautifulSoup(_get(url), "html.parser")

    entries = []
    # TODO: 実ページの出走表テーブルの class/構造に合わせてセレクタを調整
    for row in soup.select("table.race-table tbody tr"):
        cells = [c.get_text(strip=True) for c in row.select("td")]
        if not cells:
            continue
        entries.append({
            "car_no": None,     # TODO: cells[i] から車番
            "rider_name": None, # TODO: 選手名
            "score": None,      # TODO: 競走得点
            "style": None,      # TODO: 脚質
        })

    return {
        "race": {"race_date": date, "velodrome": velodrome_code, "race_no": race_no},
        "entries": entries,
    }


def fetch_race_result(date: str, velodrome_code: str, race_no: int) -> dict:
    """結果 (着順・払戻) を取得してパースする。

    Returns: {"results": [...], "payouts": [...]}
    """
    # TODO: 結果ページのURLパターン・セレクタを実ページに合わせる
    url = f"{BASE_URL}/pc/raceresult?date={date}&jo={velodrome_code}&race={race_no}"
    soup = BeautifulSoup(_get(url), "html.parser")

    results: list[dict] = []   # TODO: 着順テーブルをパース
    payouts: list[dict] = []   # TODO: 払戻テーブルをパース (bet_type/combination/payout)
    _ = soup
    return {"results": results, "payouts": payouts}
