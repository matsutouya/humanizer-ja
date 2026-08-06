# 02. アーキテクチャ・技術スタック

## 1. 結論（この構成で作る）

```
Next.js 15 (App Router) + TypeScript
  ├─ UI        : Tailwind CSS v4 + shadcn/ui
  ├─ 認証      : Auth.js (NextAuth v5) — メールマジックリンク + Google
  ├─ DB        : PostgreSQL (Neon or Supabase) + Prisma
  ├─ 決済      : Stripe Connect (Express)
  ├─ 画像      : Cloudflare R2 or Supabase Storage（S3 互換）
  ├─ メール    : Resend
  ├─ バリデーション : Zod
  ├─ ホスティング : Vercel
  └─ 定期実行  : Vercel Cron（締切処理・決済リトライ）
```

---

## 2. 選定理由

### なぜ Next.js（App Router）か
- SSR/ISR でプロジェクト詳細の SEO と初回表示速度を両立できる。クラファンは検索とSNSシェアからの流入が命。
- Server Actions でフォーム処理を書けるので、**決済まわりの重要ロジックがクライアントに漏れない**。金額をクライアントから受け取らない設計を強制しやすい。
- Vercel にそのまま乗る。インフラに時間を使わない。

### なぜ PostgreSQL か（SQLite でなく）
- 支援の同時実行がある。リターンの数量上限チェックで `SELECT ... FOR UPDATE` 相当のロックが必要になり、SQLite だと書き込みロックが全体に効いて詰まる。
- Vercel はサーバーレスなのでファイルベース DB が使えない。
- **Neon** 推奨（無料枠あり・サーバーレス接続に強い・ブランチ機能が開発時に便利）。Supabase でも可（Storage と Auth も込みで欲しいなら Supabase）。

### なぜ Prisma か
- スキーマ定義がそのままドキュメントになる（[03-db-schema.md](03-db-schema.md) がまさにそれ）。
- マイグレーションが素直。`prisma migrate dev` で回る。
- 型が全部通るのでリファクタが怖くない。
- 注意: サーバーレスでは接続数が枯渇しやすい。**Neon の pooled connection（`-pooler` 付き URL）を必ず使う**。

### なぜ Auth.js（NextAuth v5）か
- **パスワードを自前で持たない**のが最大の理由。ハッシュ管理・リセットフロー・漏洩リスクを全部回避できる。
- メールマジックリンクなら「登録＝ログイン」で UX も単純。
- Prisma アダプタが公式にあるので DB 連携がすぐ済む。

### なぜ Stripe Connect（Express）か
- マルチ出品者プラットフォームでは**必須**。自分の口座に全額入れて手動で送金すると、資金移動業の登録が必要になる恐れがある。Connect の destination charge なら「支援者→出品者」の直接取引としてお金が流れ、プラットフォームは手数料だけ受け取る形になる。
- Express は本人確認・口座登録の画面を Stripe が全部用意してくれる。自作するとまず終わらない。
- 詳細は [06-stripe.md](06-stripe.md)。

### なぜ shadcn/ui か
- コンポーネントをコピーして自分のリポジトリに置く方式なので、デザインを自由に改変できる。CAMPFIRE 風にカスタムするのに向いている。
- npm 依存にならないのでバージョン地獄がない。

---

## 3. システム構成

```
┌──────────┐        ┌─────────────────────────────┐
│ ブラウザ  │◀──────▶│  Vercel (Next.js)            │
└──────────┘        │  ├─ App Router (RSC/SSR)     │
     │              │  ├─ Server Actions           │
     │              │  ├─ /api/webhooks/stripe     │
     │              │  └─ /api/cron/*              │
     │              └────┬──────────┬──────────┬───┘
     │                   │          │          │
     │              ┌────▼────┐ ┌───▼────┐ ┌───▼─────┐
     │              │ Neon    │ │ R2 /   │ │ Resend  │
     │              │ Postgres│ │ Storage│ │ (mail)  │
     │              └─────────┘ └────────┘ └─────────┘
     │
     │  Stripe Checkout（別ドメインへリダイレクト）
     └────────────────▶┌──────────┐
                       │  Stripe  │
                       │  Connect │
                       └────┬─────┘
                            │ Webhook (署名付き)
                            ▼
                    /api/webhooks/stripe
```

**ポイント: カード情報は一切自社を経由しない。** Stripe Checkout にリダイレクトするので PCI DSS の対象範囲が最小になる。自前でカード番号フォームを作るのは絶対にやめる。

---

## 4. ディレクトリ構成

```
crowdfunding/
├── app/
│   ├── (marketing)/                 # 未ログインでも見る公開ページ
│   │   ├── page.tsx                 # トップ
│   │   ├── projects/
│   │   │   ├── page.tsx             # 一覧・検索
│   │   │   └── [slug]/
│   │   │       ├── page.tsx         # プロジェクト詳細
│   │   │       ├── updates/         # 活動報告一覧
│   │   │       └── opengraph-image.tsx  # 動的 OGP
│   │   ├── categories/[slug]/page.tsx
│   │   └── about|terms|tokushoho|privacy/page.tsx
│   ├── (app)/                       # 要ログイン
│   │   ├── dashboard/page.tsx       # マイページ
│   │   ├── backings/page.tsx        # 支援履歴
│   │   ├── settings/page.tsx
│   │   └── pledge/
│   │       ├── [projectSlug]/page.tsx   # リターン選択・確認
│   │       └── complete/page.tsx        # 支援完了
│   ├── (creator)/creator/           # 要 CREATOR ロール
│   │   ├── page.tsx                 # 出品者ダッシュボード
│   │   ├── apply/page.tsx           # 出品者申請
│   │   ├── payouts/page.tsx         # 入金設定（Stripe Connect）
│   │   └── projects/
│   │       ├── new/page.tsx
│   │       └── [id]/
│   │           ├── edit/page.tsx    # 基本情報
│   │           ├── rewards/page.tsx # リターン設定
│   │           ├── backers/page.tsx # 支援者一覧・配送先CSV
│   │           └── updates/page.tsx
│   ├── (admin)/admin/               # 要 ADMIN ロール
│   │   ├── reviews/page.tsx         # 審査キュー
│   │   ├── projects/page.tsx
│   │   ├── pledges/page.tsx
│   │   └── reports/page.tsx
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── webhooks/stripe/route.ts
│   │   ├── cron/close-projects/route.ts
│   │   ├── cron/retry-payments/route.ts
│   │   └── upload/route.ts
│   └── layout.tsx
├── components/
│   ├── ui/                          # shadcn/ui
│   ├── project/                     # ProjectCard, ProgressBar, RewardCard...
│   ├── creator/
│   └── layout/                      # Header, Footer, Nav
├── lib/
│   ├── db.ts                        # Prisma シングルトン
│   ├── auth.ts                      # Auth.js 設定
│   ├── stripe.ts                    # Stripe クライアント
│   ├── fees.ts                      # 手数料計算（唯一の真実）
│   ├── permissions.ts               # 認可チェック
│   ├── mail/                        # Resend + テンプレート
│   └── validations/                 # Zod スキーマ
├── server/
│   ├── actions/                     # Server Actions
│   └── services/                    # ドメインロジック（決済・締切処理など）
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── public/
├── docs/                            # ← 今ここ
└── .env.example
```

### 設計ルール

1. **Server Actions は薄く。** バリデーション（Zod）と認可チェックをして、`server/services/` を呼ぶだけ。ロジックを Action に書かない。
2. **金額計算は `lib/fees.ts` にしか書かない。** 手数料率の定数もここだけ。散らばると必ず不整合が出る。
3. **Prisma のクエリは Server Component / Server Action からのみ。** クライアントに DB 型を漏らさない。
4. **決済に関わる書き込みは必ずトランザクション内。** 在庫減算・Pledge 作成・集計更新をまとめる。

---

## 5. 環境分離

| 環境 | 用途 | DB | Stripe |
|---|---|---|---|
| local | 開発 | ローカル Docker Postgres or Neon ブランチ | テストキー |
| preview | Vercel の PR プレビュー | Neon ブランチ | テストキー |
| production | 本番 | Neon 本番 | 本番キー（Phase 8 以降） |

**本番キーは Phase 8 まで一切設定しない。** テストモードで全部完成させてから切り替える。

---

## 6. 依存パッケージ（初期）

```jsonc
{
  "dependencies": {
    "next": "^15",
    "react": "^19",
    "react-dom": "^19",
    "@prisma/client": "^6",
    "next-auth": "^5",
    "@auth/prisma-adapter": "^2",
    "stripe": "^17",
    "zod": "^3",
    "resend": "^4",
    "@aws-sdk/client-s3": "^3",        // R2 用（S3 互換）
    "date-fns": "^4",
    "clsx": "^2",
    "tailwind-merge": "^2",
    "lucide-react": "^0",              // アイコン
    "@radix-ui/react-*": "*",          // shadcn/ui が要求する分
    "react-markdown": "^9",
    "rehype-sanitize": "^6"            // XSS 対策。必ず入れる
  },
  "devDependencies": {
    "typescript": "^5",
    "prisma": "^6",
    "tailwindcss": "^4",
    "eslint": "^9",
    "eslint-config-next": "^15",
    "vitest": "^2",
    "@playwright/test": "^1"
  }
}
```

バージョンは実装開始時点の最新安定版を確認して決めること。上記は目安。
