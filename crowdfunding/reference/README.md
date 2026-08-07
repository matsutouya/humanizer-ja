# reference — 実装のコピー元

このリポジトリは計画。**実装は別リポジトリで行う。**
ここにあるのは、そのときそのまま貼れる形にしてあるコード。

一度組んでビルド・型チェック・Lint・ユニットテスト25件が通ることを確認済み
（Next 16 / React 19 / Tailwind 4 / Prisma 7）。

---

## 中身

```
reference/
├── package.json.reference   # 依存パッケージの実測値
├── .env.example             # 環境変数の一覧
├── lib/
│   ├── fees.ts              # ★ 手数料計算。金額の計算はここだけに書く
│   ├── ledger.ts            # ★ 複式簿記の台帳。最も後付けが効かない
│   ├── pledge-state.ts      # ★ 状態機械・在庫確保。二重計上を構造的に防ぐ
│   ├── limits.ts            # 金額上限・レート制限の定数
│   ├── db.ts                # Prisma シングルトン（ドライバアダプタ付き）
│   ├── utils.ts             # cn / 残り日数 / 達成率
│   ├── site.ts              # サイト名などの仮値
│   └── __tests__/           # fees・utils のユニットテスト（25件）
├── prisma/
│   ├── schema.prisma        # 全モデル（台帳・Outbox・監査ログ含む）
│   ├── prisma.config.ts     # ★ Prisma 7 では接続 URL をここに書く
│   └── seed.ts              # カテゴリ8件 + キルスイッチ初期値
└── ui/
    ├── app/
    │   ├── globals.css      # ★ デザイントークン（07-design.md §1.2）
    │   ├── layout.tsx
    │   ├── page.tsx         # トップページ
    │   └── styleguide-page.tsx   # → app/styleguide/page.tsx として置く
    └── components/
        ├── layout/          # SiteHeader / SiteFooter / Container
        ├── project/         # ProjectCard / ProgressBar
        └── ui/              # EmptyState
```

---

## 別リポジトリでの再現手順

```bash
# 1. プロジェクト作成（09-setup.md §1）
npx create-next-app@latest <name> \
  --typescript --tailwind --app --no-src-dir --eslint --import-alias "@/*" \
  --use-npm --turbopack

# 2. 依存を入れる（package.json.reference を参照）
npm i @prisma/client @prisma/adapter-pg pg stripe zod \
      date-fns clsx tailwind-merge lucide-react \
      react-markdown remark-gfm rehype-sanitize
npm i -D prisma tsx vitest dotenv @types/pg

# 3. 貼る
#    lib/            ← reference/lib/
#    prisma/         ← reference/prisma/（prisma.config.ts はリポジトリ直下へ）
#    app/ components/ ← reference/ui/
#    .env.example    ← reference/.env.example

# 4. DB につなぐ
npx prisma validate && npx prisma generate
npm run db:migrate && npm run db:seed
```

---

## 貼る順番（これが大事）

**`lib/` の4ファイルを最初に置く。** 画面より先。

| ファイル | なぜ先に置くか |
|---|---|
| `ledger.ts` | **後から台帳を足しても過去の取引を再構成できない。** 4つの中で最も後付けが効かない |
| `pledge-state.ts` | 状態遷移のガードを後から入れると、既存の呼び出しを全部洗い直すことになる。1つ漏れると二重計上が起きる |
| `fees.ts` | 手数料計算が複数箇所に散ると必ず不整合が出る。しかも発覚が遅い |
| `limits.ts` | 上限がないと、抜け道が見つかったときに被害が青天井になる |

---

## 守るべきルール

1. **コンポーネントの CSS に生の hex を書かない。** 必ず `globals.css` のセマンティックトークン経由。
   破った時点でダークモードの追加が不可能になる（[../docs/07-design.md](../docs/07-design.md) §10.2）
2. **金額の計算を `fees.ts` の外に書かない**
3. **台帳への書き込みは `postJournal` 経由のみ**
4. **状態遷移は `transitionPledge` 経由のみ。** 金額の加算は遷移が成功した後にだけ実行する
5. **在庫確保は条件付き UPDATE の1文で行う。** SELECT してから UPDATE しない

---

## 注意

- 型は実際の `@prisma/client` から import している。`prisma generate` を先に走らせること
- `lib/site.ts` の値は仮。[../decisions.md](../decisions.md) の A-1 / A-2 が決まったら差し替える
- UI コンポーネントは Phase 0 時点の手書き版。**Phase 2 で Base UI ＋ shadcn CLI に寄せる**
  （[../docs/14-design-system-stack.md](../docs/14-design-system-stack.md)）
- 見た目の正解は [../design/styleguide.html](../design/styleguide.html)。ブラウザで開いて見比べる
