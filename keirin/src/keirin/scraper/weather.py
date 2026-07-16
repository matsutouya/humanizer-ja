"""気象庁の過去気象データ取得。

気象庁「過去の気象データ・ダウンロード」は CSV を手動DLする仕組みだが、
観測所ごとの日別ページはURLが規則的なのでスクレイピング可能。
ここでは開催場→最寄り観測所のマッピングと取得の骨組みを用意する。

依存: pip install requests
"""

from __future__ import annotations

# 開催場 → 気象庁観測所 (prec_no, block_no)。主要場のみ。随時追加。
VELODROME_STATIONS: dict[str, tuple[int, int]] = {
    "平塚": (46, 47672),   # 神奈川・辻堂近辺 → 横浜地方気象台で代用可
    "松戸": (45, 47682),   # 千葉 → 東京で代用 (要検討)
    "岸和田": (62, 47772), # 大阪
    "小倉": (82, 47762),   # 北九州 (小倉はドームなので天候の影響は小さい)
    # TODO: 全43場ぶん整備する
}

DOME_VELODROMES = {"小倉", "前橋"}  # 屋内バンク


def is_dome(velodrome: str) -> bool:
    return velodrome in DOME_VELODROMES


def fetch_daily_weather(velodrome: str, date: str) -> dict | None:
    """指定開催場・日付の天候・平均風速・平均気温を返す。

    ドーム場は天候影響なしとして None を返す。
    TODO: 気象庁の日別データページ
      https://www.data.jma.go.jp/stats/etrn/view/daily_s1.php?prec_no=..&block_no=..&year=..&month=..
    をパースして実装する。
    """
    if is_dome(velodrome):
        return None
    if velodrome not in VELODROME_STATIONS:
        raise KeyError(f"観測所マッピング未整備: {velodrome}")
    raise NotImplementedError("気象庁ページのパースを実装する (README 参照)")
