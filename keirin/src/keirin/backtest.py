"""買い方戦略のバックテスト。

戦略は「レースを受け取り、買い目リストを返す関数」として表現する。
的中判定は payouts テーブル (実際の払戻) と突き合わせるので、
控除率・オッズの歪みを含んだ現実の回収率が出る。

回収率がランダム期待値 (約75%) を有意に超えない戦略は販売価値なし、
という判定に使うのが本モジュールの目的。
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from typing import Callable, Iterable


@dataclass
class Bet:
    bet_type: str      # win/quinella/exacta/trio/trifecta/wide
    combination: str   # 車番の組合せ。順序なし券種は昇順 "1-3", 順序ありは着順どおり
    stake: int = 100   # 賭け金 (円)


# 戦略: (conn, race_id) -> 買い目リスト
Strategy = Callable[[sqlite3.Connection, str], list[Bet]]


@dataclass
class BacktestResult:
    n_races: int = 0
    n_bets: int = 0
    n_hits: int = 0
    total_stake: int = 0
    total_return: int = 0
    per_race: list[dict] = field(default_factory=list)

    @property
    def hit_rate(self) -> float:
        return self.n_hits / self.n_bets if self.n_bets else 0.0

    @property
    def roi(self) -> float:
        """回収率 (1.0 = トントン)。"""
        return self.total_return / self.total_stake if self.total_stake else 0.0

    def summary(self) -> str:
        return (
            f"races={self.n_races} bets={self.n_bets} "
            f"hit_rate={self.hit_rate:.1%} roi={self.roi:.1%} "
            f"(stake={self.total_stake:,}円 return={self.total_return:,}円)"
        )


def run_backtest(
    conn: sqlite3.Connection,
    strategy: Strategy,
    race_ids: Iterable[str] | None = None,
) -> BacktestResult:
    if race_ids is None:
        race_ids = [r["race_id"] for r in conn.execute(
            "SELECT race_id FROM races ORDER BY race_date, race_no")]

    result = BacktestResult()
    for race_id in race_ids:
        payouts = {
            (p["bet_type"], p["combination"]): p["payout"]
            for p in conn.execute("SELECT * FROM payouts WHERE race_id = ?", (race_id,))
        }
        if not payouts:
            continue  # 結果未確定レースはスキップ

        bets = strategy(conn, race_id)
        if not bets:
            continue

        result.n_races += 1
        race_stake = race_return = 0
        for bet in bets:
            result.n_bets += 1
            race_stake += bet.stake
            payout = payouts.get((bet.bet_type, bet.combination))
            if payout is not None:
                result.n_hits += 1
                race_return += payout * bet.stake // 100

        result.total_stake += race_stake
        result.total_return += race_return
        result.per_race.append(
            {"race_id": race_id, "stake": race_stake, "return": race_return})
    return result


# --- サンプル戦略 ---

def strategy_favorite_wide(conn: sqlite3.Connection, race_id: str) -> list[Bet]:
    """競走得点上位2名のワイド1点買い (ベースライン戦略)。"""
    rows = conn.execute(
        "SELECT car_no FROM entries WHERE race_id = ? ORDER BY score DESC LIMIT 2",
        (race_id,),
    ).fetchall()
    if len(rows) < 2:
        return []
    cars = sorted(r["car_no"] for r in rows)
    return [Bet("wide", f"{cars[0]}-{cars[1]}")]


def strategy_line_quinella(conn: sqlite3.Connection, race_id: str) -> list[Bet]:
    """最も平均競走得点の高いラインの先行-番手 2車複1点買い。"""
    row = conn.execute(
        """
        SELECT line_id FROM entries
        WHERE race_id = ? AND line_id IS NOT NULL
        GROUP BY line_id HAVING COUNT(*) >= 2
        ORDER BY AVG(score) DESC LIMIT 1
        """,
        (race_id,),
    ).fetchone()
    if row is None:
        return []
    rows = conn.execute(
        """
        SELECT car_no FROM entries
        WHERE race_id = ? AND line_id = ? ORDER BY line_pos LIMIT 2
        """,
        (race_id, row["line_id"]),
    ).fetchall()
    if len(rows) < 2:
        return []
    cars = sorted(r["car_no"] for r in rows)
    return [Bet("quinella", f"{cars[0]}-{cars[1]}")]
