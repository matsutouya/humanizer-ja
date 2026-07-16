"""CLI エントリポイント。

python -m keirin.cli initdb           DB初期化
python -m keirin.cli demo             サンプルデータ投入 + バックテストのデモ
python -m keirin.cli backtest NAME    戦略のバックテスト (favorite_wide / line_quinella)
"""

from __future__ import annotations

import sys

from . import backtest as bt
from . import db
from .sample_data import load_sample_data

STRATEGIES = {
    "favorite_wide": bt.strategy_favorite_wide,
    "line_quinella": bt.strategy_line_quinella,
}


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if not args:
        print(__doc__)
        return 1

    cmd = args[0]
    if cmd == "initdb":
        db.init_db()
        print(f"initialized: {db.DEFAULT_DB}")
    elif cmd == "demo":
        conn = db.init_db(":memory:")
        load_sample_data(conn)
        for name, strat in STRATEGIES.items():
            result = bt.run_backtest(conn, strat)
            print(f"{name:15s} {result.summary()}")
    elif cmd == "backtest":
        if len(args) < 2 or args[1] not in STRATEGIES:
            print(f"strategies: {', '.join(STRATEGIES)}")
            return 1
        conn = db.connect()
        result = bt.run_backtest(conn, STRATEGIES[args[1]])
        print(result.summary())
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
