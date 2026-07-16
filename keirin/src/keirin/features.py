"""特徴量生成。

「仲の良さ」はラインの連携実績として数値化する:
- pair_line_stats: 2選手が過去に同ラインを組んだ回数と、その際どちらかが連対した率
- rider_recent_form: 直近Nレースの平均着順・勝率
- bank_affinity: バンク周長別の連対率

すべて「対象レースの日付より前」のデータのみで計算する (リーク防止)。
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass


@dataclass
class PairLineStats:
    races_together: int      # 同ラインを組んだ回数
    either_top2_rate: float  # そのうちどちらかが連対した率
    same_region: bool


def pair_line_stats(
    conn: sqlite3.Connection,
    rider_a: int,
    rider_b: int,
    before_date: str,
) -> PairLineStats:
    """2選手のライン連携実績 (before_date より前のレースのみ)。"""
    rows = conn.execute(
        """
        SELECT ea.race_id,
               MIN(COALESCE(ra.finish_pos, 99), COALESCE(rb.finish_pos, 99)) AS best_pos
        FROM entries ea
        JOIN entries eb ON ea.race_id = eb.race_id
                       AND ea.line_id = eb.line_id
                       AND ea.line_id IS NOT NULL
        JOIN races r   ON r.race_id = ea.race_id AND r.race_date < ?
        LEFT JOIN results ra ON ra.race_id = ea.race_id AND ra.rider_id = ea.rider_id
        LEFT JOIN results rb ON rb.race_id = eb.race_id AND rb.rider_id = eb.rider_id
        WHERE ea.rider_id = ? AND eb.rider_id = ?
        GROUP BY ea.race_id
        """,
        (before_date, rider_a, rider_b),
    ).fetchall()

    n = len(rows)
    top2 = sum(1 for row in rows if row["best_pos"] <= 2)

    region = conn.execute(
        "SELECT COUNT(DISTINCT region) AS c FROM riders WHERE rider_id IN (?, ?) AND region IS NOT NULL",
        (rider_a, rider_b),
    ).fetchone()
    same_region = region["c"] == 1

    return PairLineStats(
        races_together=n,
        either_top2_rate=top2 / n if n else 0.0,
        same_region=same_region,
    )


def rider_recent_form(
    conn: sqlite3.Connection,
    rider_id: int,
    before_date: str,
    n_races: int = 10,
) -> dict:
    """直近 n_races の平均着順・勝率・連対率。"""
    rows = conn.execute(
        """
        SELECT res.finish_pos
        FROM results res
        JOIN races r ON r.race_id = res.race_id
        WHERE res.rider_id = ? AND r.race_date < ? AND res.finish_pos IS NOT NULL
        ORDER BY r.race_date DESC
        LIMIT ?
        """,
        (rider_id, before_date, n_races),
    ).fetchall()

    positions = [row["finish_pos"] for row in rows]
    n = len(positions)
    return {
        "n": n,
        "avg_finish": sum(positions) / n if n else None,
        "win_rate": sum(1 for p in positions if p == 1) / n if n else 0.0,
        "top2_rate": sum(1 for p in positions if p <= 2) / n if n else 0.0,
    }


def bank_affinity(
    conn: sqlite3.Connection,
    rider_id: int,
    bank_length: int,
    before_date: str,
) -> dict:
    """指定バンク周長での連対率。"""
    rows = conn.execute(
        """
        SELECT res.finish_pos
        FROM results res
        JOIN races r ON r.race_id = res.race_id
        WHERE res.rider_id = ? AND r.bank_length = ? AND r.race_date < ?
              AND res.finish_pos IS NOT NULL
        """,
        (rider_id, bank_length, before_date),
    ).fetchall()
    n = len(rows)
    top2 = sum(1 for row in rows if row["finish_pos"] <= 2)
    return {"n": n, "top2_rate": top2 / n if n else 0.0}


def race_features(conn: sqlite3.Connection, race_id: str) -> list[dict]:
    """1レース分の全出走選手の特徴量ベクトルを返す (学習・予測用)。"""
    race = conn.execute("SELECT * FROM races WHERE race_id = ?", (race_id,)).fetchone()
    if race is None:
        raise ValueError(f"unknown race_id: {race_id}")

    entries = conn.execute(
        """
        SELECT e.*, ri.region, ri.style FROM entries e
        JOIN riders ri ON ri.rider_id = e.rider_id
        WHERE e.race_id = ? ORDER BY e.car_no
        """,
        (race_id,),
    ).fetchall()

    feats = []
    for e in entries:
        form = rider_recent_form(conn, e["rider_id"], race["race_date"])
        bank = bank_affinity(conn, e["rider_id"], race["bank_length"], race["race_date"]) if race["bank_length"] else {"n": 0, "top2_rate": 0.0}

        # 同ライン相手との連携実績 (最良値を採用)
        mates = [m for m in entries
                 if m["line_id"] == e["line_id"] and m["line_id"] is not None
                 and m["rider_id"] != e["rider_id"]]
        pair_rates = [
            pair_line_stats(conn, e["rider_id"], m["rider_id"], race["race_date"]).either_top2_rate
            for m in mates
        ]

        feats.append({
            "race_id": race_id,
            "rider_id": e["rider_id"],
            "car_no": e["car_no"],
            "score": e["score"],
            "style": e["style"],
            "line_pos": e["line_pos"],
            "line_size": len(mates) + 1,
            "best_pair_top2_rate": max(pair_rates) if pair_rates else 0.0,
            "recent_avg_finish": form["avg_finish"],
            "recent_top2_rate": form["top2_rate"],
            "bank_top2_rate": bank["top2_rate"],
            "wind_speed": race["wind_speed"],
        })
    return feats
