"""SQLite スキーマ定義と接続ヘルパ。

外部依存なし。テーブル設計:

- riders:   選手マスタ (登録番号・地区・府県・期別・脚質)
- races:    レース (開催場・日付・レース番号・バンク周長・天候)
- entries:  出走 (レース×選手, 車番・ライン位置・競走得点)
- results:  結果 (着順・上がりタイム)
- odds:     確定オッズ (券種・買い目・オッズ)
- payouts:  払戻 (券種・的中買い目・払戻金)
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parents[2] / "keirin.sqlite3"

SCHEMA = """
CREATE TABLE IF NOT EXISTS riders (
    rider_id     INTEGER PRIMARY KEY,          -- 選手登録番号
    name         TEXT NOT NULL,
    region       TEXT,                          -- 地区 (北日本/関東/南関東/中部/近畿/中国/四国/九州)
    prefecture   TEXT,                          -- 登録府県
    term         INTEGER,                       -- 期別
    style        TEXT,                          -- 脚質: 逃/両/追
    grade        TEXT                           -- 級班: SS/S1/S2/A1/A2/A3
);

CREATE TABLE IF NOT EXISTS races (
    race_id      TEXT PRIMARY KEY,              -- 例: 20260716_平塚_11R
    velodrome    TEXT NOT NULL,                 -- 開催場
    race_date    TEXT NOT NULL,                 -- YYYY-MM-DD
    race_no      INTEGER NOT NULL,
    bank_length  INTEGER,                       -- バンク周長 m (333/400/500)
    is_dome      INTEGER DEFAULT 0,             -- 屋内バンクか
    weather      TEXT,                          -- 晴/曇/雨 (屋外のみ)
    wind_speed   REAL,                          -- m/s
    temperature  REAL
);

CREATE TABLE IF NOT EXISTS entries (
    race_id      TEXT NOT NULL REFERENCES races(race_id),
    rider_id     INTEGER NOT NULL REFERENCES riders(rider_id),
    car_no       INTEGER NOT NULL,              -- 車番 1-9
    line_id      INTEGER,                       -- 同レース内のライン識別 (並び順に0,1,2..)
    line_pos     INTEGER,                       -- ライン内位置 (0=先頭/先行, 1=番手, 2=三番手)
    score        REAL,                          -- 競走得点
    PRIMARY KEY (race_id, rider_id)
);

CREATE TABLE IF NOT EXISTS results (
    race_id      TEXT NOT NULL REFERENCES races(race_id),
    rider_id     INTEGER NOT NULL REFERENCES riders(rider_id),
    finish_pos   INTEGER,                       -- 着順 (失格等は NULL)
    last_lap     REAL,                          -- 上がりタイム
    PRIMARY KEY (race_id, rider_id)
);

CREATE TABLE IF NOT EXISTS odds (
    race_id      TEXT NOT NULL REFERENCES races(race_id),
    bet_type     TEXT NOT NULL,                 -- win/quinella/exacta/trio/trifecta/wide
    combination  TEXT NOT NULL,                 -- 例: "1-3" "1-3-5" (車番昇順, 順序ありは順序どおり)
    odds         REAL NOT NULL,
    PRIMARY KEY (race_id, bet_type, combination)
);

CREATE TABLE IF NOT EXISTS payouts (
    race_id      TEXT NOT NULL REFERENCES races(race_id),
    bet_type     TEXT NOT NULL,
    combination  TEXT NOT NULL,
    payout       INTEGER NOT NULL,              -- 100円あたり払戻金
    PRIMARY KEY (race_id, bet_type, combination)
);

CREATE INDEX IF NOT EXISTS idx_entries_rider ON entries(rider_id);
CREATE INDEX IF NOT EXISTS idx_results_rider ON results(rider_id);
CREATE INDEX IF NOT EXISTS idx_races_date ON races(race_date);
"""


def connect(db_path: str | Path = DEFAULT_DB) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: str | Path = DEFAULT_DB) -> sqlite3.Connection:
    conn = connect(db_path)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn
