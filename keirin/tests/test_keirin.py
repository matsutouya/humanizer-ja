import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from keirin import backtest as bt  # noqa: E402
from keirin import db, features  # noqa: E402
from keirin.sample_data import load_sample_data  # noqa: E402


def make_conn():
    conn = db.init_db(":memory:")
    load_sample_data(conn)
    return conn


class TestFeatures(unittest.TestCase):
    def setUp(self):
        self.conn = make_conn()

    def test_pair_line_stats_no_leak(self):
        # 2026-07-01 より前のデータはないので実績ゼロ
        stats = features.pair_line_stats(self.conn, 1001, 1002, "2026-07-01")
        self.assertEqual(stats.races_together, 0)
        self.assertTrue(stats.same_region)

    def test_pair_line_stats_accumulates(self):
        # 07-08 時点では 07-01 の平塚11Rで同ライン、2人とも連対 (1着・2着)
        stats = features.pair_line_stats(self.conn, 1001, 1002, "2026-07-08")
        self.assertEqual(stats.races_together, 1)
        self.assertEqual(stats.either_top2_rate, 1.0)

    def test_recent_form(self):
        form = features.rider_recent_form(self.conn, 1001, "2026-07-08")
        self.assertEqual(form["n"], 1)
        self.assertEqual(form["avg_finish"], 2)
        self.assertEqual(form["top2_rate"], 1.0)

    def test_race_features_shape(self):
        feats = features.race_features(self.conn, "20260708_岸和田_11")
        self.assertEqual(len(feats), 5)
        f1001 = next(f for f in feats if f["rider_id"] == 1001)
        self.assertEqual(f1001["line_size"], 3)
        self.assertEqual(f1001["best_pair_top2_rate"], 1.0)


class TestBacktest(unittest.TestCase):
    def setUp(self):
        self.conn = make_conn()

    def test_favorite_wide(self):
        result = bt.run_backtest(self.conn, bt.strategy_favorite_wide)
        self.assertEqual(result.n_races, 4)
        self.assertEqual(result.n_bets, 4)
        # 得点上位2名: 平塚11R=車番1,3(外れ) 平塚12R=車番2,3(的中)
        # 岸和田11R=車番1,4(外れ) 岸和田12R=車番3,4(外れ)
        self.assertEqual(result.n_hits, 1)
        self.assertEqual(result.total_stake, 400)
        self.assertEqual(result.total_return, 250)

    def test_line_quinella(self):
        result = bt.run_backtest(self.conn, bt.strategy_line_quinella)
        self.assertGreater(result.n_bets, 0)
        self.assertGreaterEqual(result.roi, 0.0)

    def test_summary_format(self):
        result = bt.run_backtest(self.conn, bt.strategy_favorite_wide)
        self.assertIn("roi=", result.summary())


if __name__ == "__main__":
    unittest.main()
