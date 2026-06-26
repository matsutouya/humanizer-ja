#!/usr/bin/env python3
"""FocusGuard — ADHD 向けの「だんだん厳しくなる」作業強制アプリ.

コンセプト
----------
PC 自体は止めない(作業に使うので)。代わりに「離席・別作業・サボり」を検知し、
段階的に強くなる介入(通知 → 警告音 → 全画面オーバーレイ → 解除条件強化)で
宣言したタスクへ強制的に引き戻す。完了するまで解放されない。

強制力の 2 本柱
---------------
1. 離席検知      : キーボード/マウス無操作が一定時間続くと発火
2. 定期チェックイン: 操作していても、一定間隔で「進捗を記録」しないと
                    別作業とみなして発火

安全策
------
ロックアウト事故を防ぐため、緊急脱出を常に残す(長文の宣言入力という
"摩擦" を課すことで衝動的な中断は抑止しつつ、物理的に閉じ込めない)。

依存ライブラリなし(標準ライブラリ tkinter のみ)。Python 3.8+。
    python3 focusguard.py
"""

from __future__ import annotations

import platform
import subprocess
import sys
import time
import tkinter as tk
from tkinter import font as tkfont

# ----------------------------------------------------------------------------
# 設定(必要ならここを書き換える)
# ----------------------------------------------------------------------------

# チェックイン間隔(秒). この間隔ごとに「進捗を記録」しないとペナルティが上がる
CHECKIN_INTERVAL_SEC = 8 * 60
# 離席判定(秒). 無操作がこれを超えるとペナルティが上がる
IDLE_LIMIT_SEC = 90
# ペナルティが 1 段階下がる(落ち着く)までの猶予(秒)
DECAY_AFTER_SEC = 30
# 緊急脱出で入力させる宣言文(これを正確に打たないと中断できない)
EMERGENCY_PHRASE = "わたしは今この作業を中断することを自分で選びました"

PALETTE = {
    "bg": "#11131a",
    "panel": "#1b1f2a",
    "fg": "#e8eaf0",
    "muted": "#8b93a7",
    "accent": "#4f8cff",
    "warn": "#ffb020",
    "danger": "#ff4d4f",
    "ok": "#36c275",
}


# ----------------------------------------------------------------------------
# 離席(アイドル)検知 — OS ごとにベストエフォート
# ----------------------------------------------------------------------------

def _idle_seconds_windows() -> float | None:
    import ctypes

    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]

    info = LASTINPUTINFO()
    info.cbSize = ctypes.sizeof(info)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        return None
    millis = ctypes.windll.kernel32.GetTickCount() - info.dwTime
    return millis / 1000.0


def _idle_seconds_macos() -> float | None:
    try:
        out = subprocess.check_output(
            ["ioreg", "-c", "IOHIDSystem"], text=True, stderr=subprocess.DEVNULL
        )
    except Exception:
        return None
    for line in out.splitlines():
        if "HIDIdleTime" in line:
            try:
                nanos = int(line.rsplit("=", 1)[1].strip())
                return nanos / 1_000_000_000.0
            except (ValueError, IndexError):
                return None
    return None


def _idle_seconds_linux() -> float | None:
    # xprintidle があれば使う(なければ None でチェックイン主体になる)
    try:
        out = subprocess.check_output(["xprintidle"], stderr=subprocess.DEVNULL)
        return int(out.strip()) / 1000.0
    except Exception:
        return None


def get_idle_seconds() -> float | None:
    """無操作秒数を返す. 取得不可なら None(その場合はチェックインのみで運用)."""
    system = platform.system()
    try:
        if system == "Windows":
            return _idle_seconds_windows()
        if system == "Darwin":
            return _idle_seconds_macos()
        return _idle_seconds_linux()
    except Exception:
        return None


# ----------------------------------------------------------------------------
# 警告音 — ベストエフォート
# ----------------------------------------------------------------------------

def beep(level: int) -> None:
    """ペナルティレベルに応じてうるさくする."""
    try:
        if platform.system() == "Windows":
            import winsound

            freq = 600 + level * 150
            for _ in range(max(1, level - 1)):
                winsound.Beep(min(freq, 2200), 200)
            return
    except Exception:
        pass
    # 他 OS / 失敗時はターミナルベル(鳴らない環境もある)
    sys.stdout.write("\a" * max(1, level - 1))
    sys.stdout.flush()


# ----------------------------------------------------------------------------
# 本体
# ----------------------------------------------------------------------------

class FocusGuard:
    # ペナルティの段階(だんだん厳しく)
    #  0: 平穏
    #  1: タイトル点滅・やわらかい通知
    #  2: 軽い警告音 + 最前面リマインダ
    #  3: うるさい警告音 + 強い最前面
    #  4: 全画面オーバーレイ(クリックで戻る)
    #  5: 全画面 + タスク名を正確に入力して解除
    #  6: 全画面 + タスク名入力 + 強制待機カウントダウン
    MAX_LEVEL = 6

    def __init__(self, root: tk.Tk):
        self.root = root
        self.task = ""
        self.total_seconds = 0
        self.remaining = 0
        self.running = False
        self.paused = False

        self.level = 0
        self.last_checkin = time.monotonic()
        self.last_trigger = 0.0
        self.last_resolve = time.monotonic()
        self.overlay: tk.Toplevel | None = None
        self.flash_state = False

        self.idle_supported = get_idle_seconds() is not None

        self.root.title("FocusGuard")
        self.root.configure(bg=PALETTE["bg"])
        self.root.geometry("520x560")
        self.root.minsize(460, 520)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close_request)

        self._build_setup_screen()

    # ----- 画面構築 -------------------------------------------------------

    def _h(self, size: int, weight: str = "normal") -> tkfont.Font:
        return tkfont.Font(family="Helvetica", size=size, weight=weight)

    def _clear(self) -> None:
        for w in self.root.winfo_children():
            w.destroy()

    def _build_setup_screen(self) -> None:
        self._clear()
        p = PALETTE
        wrap = tk.Frame(self.root, bg=p["bg"])
        wrap.pack(fill="both", expand=True, padx=28, pady=26)

        tk.Label(wrap, text="FocusGuard", font=self._h(26, "bold"),
                 fg=p["accent"], bg=p["bg"]).pack(anchor="w")
        tk.Label(wrap, text="終わるまで逃がさない作業強制モード",
                 font=self._h(11), fg=p["muted"], bg=p["bg"]).pack(anchor="w", pady=(0, 18))

        tk.Label(wrap, text="今からやるタスク", font=self._h(12, "bold"),
                 fg=p["fg"], bg=p["bg"]).pack(anchor="w")
        self.task_entry = tk.Entry(wrap, font=self._h(13), bg=p["panel"], fg=p["fg"],
                                   insertbackground=p["fg"], relief="flat")
        self.task_entry.pack(fill="x", ipady=8, pady=(4, 16))
        self.task_entry.insert(0, "例: レポートの第1章を書き終える")

        row = tk.Frame(wrap, bg=p["bg"])
        row.pack(fill="x", pady=(0, 16))
        tk.Label(row, text="制限時間(分)", font=self._h(12, "bold"),
                 fg=p["fg"], bg=p["bg"]).pack(side="left")
        self.minutes_var = tk.StringVar(value="25")
        tk.Spinbox(row, from_=1, to=600, textvariable=self.minutes_var, width=6,
                   font=self._h(13), bg=p["panel"], fg=p["fg"], relief="flat",
                   buttonbackground=p["panel"], insertbackground=p["fg"]).pack(side="left", padx=10)

        info = (
            f"・{IDLE_LIMIT_SEC} 秒以上の離席を検知すると介入します"
            if self.idle_supported else
            "・この環境では離席検知が使えないため、チェックイン主体で動きます"
        )
        tk.Label(wrap, text=info, font=self._h(10), fg=p["muted"],
                 bg=p["bg"], justify="left", wraplength=440).pack(anchor="w")
        tk.Label(wrap,
                 text=f"・{CHECKIN_INTERVAL_SEC // 60} 分ごとに「進捗を記録」しないとペナルティが上がります\n"
                      "・サボるほど介入が強くなります(通知→警告音→全画面ロック)\n"
                      "・緊急脱出は残してあります(衝動的な中断はしにくくしてあります)",
                 font=self._h(10), fg=p["muted"], bg=p["bg"],
                 justify="left", wraplength=440).pack(anchor="w", pady=(4, 22))

        start = tk.Button(wrap, text="開始する(覚悟して)", font=self._h(14, "bold"),
                          bg=p["accent"], fg="white", relief="flat", cursor="hand2",
                          activebackground=p["accent"], activeforeground="white",
                          command=self._start_session)
        start.pack(fill="x", ipady=12)

    def _build_session_screen(self) -> None:
        self._clear()
        p = PALETTE
        wrap = tk.Frame(self.root, bg=p["bg"])
        wrap.pack(fill="both", expand=True, padx=28, pady=26)

        tk.Label(wrap, text="集中中", font=self._h(12, "bold"),
                 fg=p["muted"], bg=p["bg"]).pack(anchor="w")
        tk.Label(wrap, text=self.task, font=self._h(16, "bold"), fg=p["fg"],
                 bg=p["bg"], wraplength=440, justify="left").pack(anchor="w", pady=(2, 16))

        self.timer_label = tk.Label(wrap, text="00:00", font=self._h(48, "bold"),
                                    fg=p["accent"], bg=p["bg"])
        self.timer_label.pack(pady=(4, 8))

        self.status_label = tk.Label(wrap, text="", font=self._h(11),
                                    fg=p["muted"], bg=p["bg"])
        self.status_label.pack()

        self.level_canvas = tk.Canvas(wrap, height=14, bg=p["panel"],
                                      highlightthickness=0)
        self.level_canvas.pack(fill="x", pady=(18, 6))
        self.level_text = tk.Label(wrap, text="", font=self._h(10),
                                   fg=p["muted"], bg=p["bg"])
        self.level_text.pack()

        self.checkin_btn = tk.Button(wrap, text="進捗を記録(チェックイン)",
                                     font=self._h(14, "bold"), bg=p["ok"], fg="white",
                                     relief="flat", cursor="hand2",
                                     activebackground=p["ok"], activeforeground="white",
                                     command=self._do_checkin)
        self.checkin_btn.pack(fill="x", ipady=12, pady=(24, 10))

        self.done_btn = tk.Button(wrap, text="✓ タスク完了で解放",
                                  font=self._h(13, "bold"), bg=p["panel"], fg=p["ok"],
                                  relief="flat", cursor="hand2",
                                  activebackground=p["panel"], activeforeground=p["ok"],
                                  command=self._complete)
        self.done_btn.pack(fill="x", ipady=10, pady=(0, 8))

        tk.Button(wrap, text="緊急脱出(中断)", font=self._h(10), bg=p["bg"],
                  fg=p["muted"], relief="flat", cursor="hand2",
                  activebackground=p["bg"], activeforeground=p["danger"],
                  command=self._emergency_exit).pack()

    # ----- セッション制御 -------------------------------------------------

    def _start_session(self) -> None:
        task = self.task_entry.get().strip()
        if not task or task.startswith("例:"):
            self.task_entry.configure(highlightthickness=1,
                                      highlightbackground=PALETTE["danger"],
                                      highlightcolor=PALETTE["danger"])
            return
        try:
            minutes = max(1, int(self.minutes_var.get()))
        except ValueError:
            minutes = 25
        self.task = task
        self.total_seconds = minutes * 60
        self.remaining = self.total_seconds
        self.running = True
        self.level = 0
        now = time.monotonic()
        self.last_checkin = now
        self.last_resolve = now
        self._build_session_screen()
        self._tick()

    def _do_checkin(self) -> None:
        self.last_checkin = time.monotonic()
        self._lower_level(reset=True)
        self._close_overlay()
        self.status_label.configure(text="記録しました。引き続き集中。",
                                    fg=PALETTE["ok"])

    def _complete(self) -> None:
        self.running = False
        self._close_overlay()
        self._clear()
        p = PALETTE
        wrap = tk.Frame(self.root, bg=p["bg"])
        wrap.pack(fill="both", expand=True, padx=28, pady=40)
        tk.Label(wrap, text="✓ 完了!", font=self._h(34, "bold"),
                 fg=p["ok"], bg=p["bg"]).pack(pady=(20, 10))
        tk.Label(wrap, text=self.task, font=self._h(14), fg=p["fg"], bg=p["bg"],
                 wraplength=440).pack()
        elapsed = self.total_seconds - max(0, self.remaining)
        tk.Label(wrap, text=f"集中時間: {elapsed // 60} 分 {elapsed % 60} 秒",
                 font=self._h(12), fg=p["muted"], bg=p["bg"]).pack(pady=12)
        tk.Button(wrap, text="新しいタスク", font=self._h(13, "bold"),
                  bg=p["accent"], fg="white", relief="flat", cursor="hand2",
                  command=self._build_setup_screen).pack(fill="x", ipady=10, pady=20)

    def _emergency_exit(self) -> None:
        self._prompt_phrase(
            title="本当に中断しますか?",
            message="衝動的な中断を防ぐため、次の文を正確に入力してください。",
            phrase=EMERGENCY_PHRASE,
            on_success=self._abort,
        )

    def _abort(self) -> None:
        self.running = False
        self._close_overlay()
        self._build_setup_screen()

    # ----- メインループ ---------------------------------------------------

    def _tick(self) -> None:
        if not self.running:
            return
        now = time.monotonic()

        # タイマー更新
        self.remaining -= 1
        mins, secs = divmod(max(0, self.remaining), 60)
        self.timer_label.configure(text=f"{mins:02d}:{secs:02d}")
        if self.remaining <= 0:
            # 時間切れ = まだ終わってない → 最大級の介入
            self._raise_level(to=self.MAX_LEVEL, reason="時間切れ")

        # 離席検知
        idle = get_idle_seconds()
        idle_txt = ""
        if idle is not None:
            idle_txt = f"無操作 {int(idle)}s / "
            if idle >= self._idle_limit_for_level():
                self._raise_level(reason="離席")

        # チェックイン期限
        since_checkin = now - self.last_checkin
        remain_checkin = max(0, CHECKIN_INTERVAL_SEC - int(since_checkin))
        if since_checkin >= CHECKIN_INTERVAL_SEC:
            self._raise_level(reason="チェックイン未実施")

        # ペナルティの自然減衰(落ち着いてきたら緩める)
        if self.level > 0 and (now - self.last_resolve) >= DECAY_AFTER_SEC \
                and (now - self.last_trigger) >= DECAY_AFTER_SEC:
            self._lower_level()
            self.last_resolve = now

        self.status_label.configure(
            text=f"{idle_txt}次のチェックインまで {remain_checkin}s",
            fg=PALETTE["muted"])
        self._render_level()
        self._apply_penalty()

        self.root.after(1000, self._tick)

    # ----- ペナルティ -----------------------------------------------------

    def _idle_limit_for_level(self) -> float:
        # レベルが上がるほど離席に厳しく(短く)なる
        return max(20, IDLE_LIMIT_SEC - self.level * 12)

    def _raise_level(self, to: int | None = None, reason: str = "") -> None:
        now = time.monotonic()
        # 連続発火しすぎないよう、最短 4 秒間隔で 1 段ずつ
        if to is None:
            if now - self.last_trigger < 4:
                return
            self.level = min(self.MAX_LEVEL, self.level + 1)
        else:
            self.level = max(self.level, to)
        self.last_trigger = now
        if reason:
            self.status_label.configure(text=f"⚠ {reason} を検知 — 介入レベル {self.level}",
                                        fg=PALETTE["warn"])

    def _lower_level(self, reset: bool = False) -> None:
        if reset:
            self.level = 0
        else:
            self.level = max(0, self.level - 1)
        if self.level == 0:
            self._close_overlay()

    def _render_level(self) -> None:
        c = self.level_canvas
        c.delete("all")
        w = c.winfo_width() or 460
        seg = w / self.MAX_LEVEL
        for i in range(self.MAX_LEVEL):
            color = PALETTE["panel"]
            if i < self.level:
                color = PALETTE["danger"] if self.level >= 4 else PALETTE["warn"]
            c.create_rectangle(i * seg + 1, 1, (i + 1) * seg - 1, 13,
                               fill=color, outline="")
        labels = {0: "平穏", 1: "注意", 2: "警告音", 3: "強警告",
                  4: "全画面ロック", 5: "解除に入力", 6: "強制待機"}
        self.level_text.configure(
            text=f"介入レベル {self.level}/{self.MAX_LEVEL} — {labels.get(self.level, '')}")

    def _apply_penalty(self) -> None:
        lvl = self.level
        if lvl == 0:
            self.root.attributes("-topmost", False)
            return

        if lvl == 1:
            # タイトル点滅
            self.flash_state = not self.flash_state
            self.root.title("⚠ 作業に戻って" if self.flash_state else "FocusGuard")
        elif lvl == 2:
            beep(lvl)
            self.root.attributes("-topmost", True)
            self.root.lift()
        elif lvl == 3:
            beep(lvl)
            self.root.attributes("-topmost", True)
            self.root.lift()
            self.root.focus_force()
        elif lvl >= 4:
            beep(lvl)
            self._show_overlay()

    # ----- 全画面オーバーレイ --------------------------------------------

    def _show_overlay(self) -> None:
        if self.overlay is not None and self.overlay.winfo_exists():
            self._refresh_overlay()
            return
        p = PALETTE
        ov = tk.Toplevel(self.root)
        self.overlay = ov
        ov.configure(bg=p["danger"] if self.level >= 5 else p["bg"])
        ov.attributes("-topmost", True)
        try:
            ov.attributes("-fullscreen", True)
        except tk.TclError:
            ov.geometry(f"{ov.winfo_screenwidth()}x{ov.winfo_screenheight()}+0+0")
        ov.protocol("WM_DELETE_WINDOW", lambda: None)  # 閉じさせない

        self._overlay_body = tk.Frame(ov, bg=ov["bg"])
        self._overlay_body.place(relx=0.5, rely=0.5, anchor="center")
        self._refresh_overlay()

        # 最前面を維持しようとする
        def keep_top():
            if self.overlay and self.overlay.winfo_exists():
                self.overlay.lift()
                self.overlay.attributes("-topmost", True)
                self.overlay.after(700, keep_top)
        keep_top()

    def _refresh_overlay(self) -> None:
        ov = self.overlay
        if ov is None or not ov.winfo_exists():
            return
        for w in self._overlay_body.winfo_children():
            w.destroy()
        p = PALETTE
        body = self._overlay_body
        ov.configure(bg=p["danger"] if self.level >= 5 else p["bg"])
        body.configure(bg=ov["bg"])

        tk.Label(body, text="作業に戻れ", font=self._h(40, "bold"),
                 fg="white", bg=ov["bg"]).pack(pady=(0, 12))
        tk.Label(body, text=self.task, font=self._h(20), fg="white",
                 bg=ov["bg"], wraplength=700).pack(pady=(0, 24))

        if self.level == 4:
            tk.Button(body, text="作業に戻る(チェックイン)", font=self._h(16, "bold"),
                      bg="white", fg=p["bg"], relief="flat", cursor="hand2",
                      command=self._do_checkin).pack(ipady=10, ipadx=20)
        else:
            # レベル 5,6: タスク名を正確に入力させる
            tk.Label(body, text="解除するには下に「タスク名」を正確に入力:",
                     font=self._h(13), fg="white", bg=ov["bg"]).pack()
            ent = tk.Entry(body, font=self._h(16), width=40, relief="flat",
                           justify="center")
            ent.pack(ipady=8, pady=10)
            ent.focus_set()
            btn = tk.Button(body, text="解除", font=self._h(14, "bold"),
                            bg="white", fg=p["bg"], relief="flat", cursor="hand2")
            btn.pack(ipady=8, ipadx=16)

            def try_unlock():
                if ent.get().strip() == self.task.strip():
                    if self.level >= 6:
                        self._forced_wait_then(self._do_checkin)
                    else:
                        self._do_checkin()
                else:
                    ent.configure(bg="#ffd6d6")
            btn.configure(command=try_unlock)
            ent.bind("<Return>", lambda e: try_unlock())

        # 緊急脱出は常に残す(小さく)
        tk.Button(body, text="緊急脱出", font=self._h(9), bg=ov["bg"],
                  fg="#ffffff", relief="flat", cursor="hand2",
                  activebackground=ov["bg"],
                  command=self._emergency_exit).pack(pady=(28, 0))

    def _forced_wait_then(self, callback, seconds: int = 10) -> None:
        for w in self._overlay_body.winfo_children():
            w.destroy()
        p = PALETTE
        lbl = tk.Label(self._overlay_body, text="", font=self._h(60, "bold"),
                       fg="white", bg=self._overlay_body["bg"])
        lbl.pack(pady=40)
        tk.Label(self._overlay_body, text="深呼吸して、戻る準備をしよう",
                 font=self._h(16), fg="white",
                 bg=self._overlay_body["bg"]).pack()

        def countdown(n):
            if not (self.overlay and self.overlay.winfo_exists()):
                return
            if n <= 0:
                callback()
                return
            lbl.configure(text=str(n))
            self.overlay.after(1000, lambda: countdown(n - 1))
        countdown(seconds)

    def _close_overlay(self) -> None:
        if self.overlay is not None and self.overlay.winfo_exists():
            self.overlay.destroy()
        self.overlay = None

    # ----- 共通: 宣言文入力プロンプト ------------------------------------

    def _prompt_phrase(self, title: str, message: str, phrase: str,
                       on_success) -> None:
        p = PALETTE
        dlg = tk.Toplevel(self.root)
        dlg.title(title)
        dlg.configure(bg=p["bg"])
        dlg.attributes("-topmost", True)
        dlg.geometry("520x300")
        dlg.transient(self.root)
        dlg.grab_set()

        tk.Label(dlg, text=title, font=self._h(16, "bold"), fg=p["danger"],
                 bg=p["bg"]).pack(pady=(20, 6), padx=20)
        tk.Label(dlg, text=message, font=self._h(11), fg=p["muted"], bg=p["bg"],
                 wraplength=460, justify="left").pack(padx=20)
        tk.Label(dlg, text=phrase, font=self._h(12, "bold"), fg=p["fg"], bg=p["panel"],
                 wraplength=460, justify="left").pack(padx=20, pady=12, ipady=8, ipadx=8,
                                                      fill="x")
        ent = tk.Entry(dlg, font=self._h(12), bg=p["panel"], fg=p["fg"],
                       insertbackground=p["fg"], relief="flat")
        ent.pack(fill="x", padx=20, ipady=6)
        ent.focus_set()
        msg = tk.Label(dlg, text="", font=self._h(10), fg=p["danger"], bg=p["bg"])
        msg.pack(pady=4)

        def confirm():
            if ent.get().strip() == phrase:
                dlg.destroy()
                on_success()
            else:
                msg.configure(text="一致しません。正確に入力してください。")

        btns = tk.Frame(dlg, bg=p["bg"])
        btns.pack(pady=10)
        tk.Button(btns, text="やめる", font=self._h(11), bg=p["panel"], fg=p["fg"],
                  relief="flat", command=dlg.destroy).pack(side="left", padx=6)
        tk.Button(btns, text="確定", font=self._h(11, "bold"), bg=p["danger"],
                  fg="white", relief="flat", command=confirm).pack(side="left", padx=6)
        ent.bind("<Return>", lambda e: confirm())

    # ----- 閉じる要求 -----------------------------------------------------

    def _on_close_request(self) -> None:
        if not self.running:
            self.root.destroy()
            return
        # セッション中はそのまま閉じさせない → 緊急脱出へ誘導
        self._emergency_exit()


def main() -> None:
    root = tk.Tk()
    FocusGuard(root)
    root.mainloop()


if __name__ == "__main__":
    main()
