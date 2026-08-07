# 02. アーキテクチャ・技術スタック

## 1. 結論（この構成で作る）

> ✅ **Phase 0 実施済み。** 実際に構築した構成は下記のとおり。
> 計画時点から変わった点は「Prisma 7 で接続 URL の置き場所が変わった」ことと、
> 「shadcn/ui を初期導入せず、必要なコンポーネントを手書きした」こと。

```
Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
  ├─ UI        : Tailwind CSS v4（コンポーネントは手書き。shadcn/ui は Phase 2 で検討）
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

#### ⚠️ Prisma 7 での変更点（Phase 0 でハマった箇所）

Prisma 7 から、**接続 URL を `schema.prisma` に書けなくなった。** また **ドライバアダプタが必須**になった。

| | Prisma 6 まで | **Prisma 7** |
|---|---|---|
| 接続 URL | `datasource db { url = env(...) }` | `prisma.config.ts` の `datasource.url` |
| `directUrl` | `datasource` に書く | **廃止**。CLI 用の URL は1つだけ |
| クライアント生成 | `new PrismaClient()` | `new PrismaClient({ adapter })` が必須 |
| 追加パッケージ | — | `@prisma/adapter-pg` + `pg` |

**重要な帰結: CLI 用とアプリ用で接続先が分かれる。**

```
prisma.config.ts の url  →  DIRECT_URL（pooler を通さない）… migrate / studio / seed
lib/db.ts のアダプタ      →  DATABASE_URL（pooled）        … アプリ実行時
```

pooler 経由ではマイグレーションが正しく動かないため、この分離が必要。
**取り違えると「本番で接続数が枯渇する」か「マイグレーションが失敗する」のどちらかになる。**

### shadcn/ui は初期導入していない

計画では shadcn/ui を使う想定だったが、Phase 0 では入れていない。

- 必要なのは Button / Badge / Card 程度で、[07-design.md](07-design.md) のトークンに合わせて手書きしたほうが速い
- Tailwind 4 + Next 16 の組み合わせでの初期化を検証する手間を、いま払う必要がない

フォーム・ダイアログ・ドロップダウンが増える **Phase 2 で導入を再検討する**。
手書きした分は `components/ui/` にまとまっているので、置き換えは局所的に済む。

### なぜ Auth.js（NextAuth v5）か
- **パスワードを自前で持たない**のが最大の理由。ハッシュ管理・リセットフロー・漏洩リスクを全部回避できる。
- メールマジックリンクなら「登録＝ログイン」で UX も単純。
- Prisma アダプタが公式にあるので DB 連携がすぐ済む。

### なぜ Stripe Connect（Express）か
- マルチ出品者プラットフォームでは**必須**。自分の口座に全額入れて手動で送金すると、資金移動業の登録が必要になる恐れがある。Connect の destination charge なら「支援者→出品者」の直接取引としてお金が流れ、プラットフォームは手数料だけ受け取る形になる。
- Express は本人確認・口座登録の画面を Stripe が全部用意してくれる。自作するとまず終わらない。
- 詳細は [06-stripe.md](06-stripe.md)。

### shadcn/ui を将来入れるとしたら
- コンポーネントをコピーして自分のリポジトリに置く方式なので、デザインを自由に改変できる。CAMPFIRE 風にカスタムするのに向いている。
- npm 依存にならないのでバージョン地獄がない。
- ただし Phase 0 では見送った（上記「shadcn/ui は初期導入していない」）。

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
│   ├── ui/                          # 汎用 UI（EmptyState など）
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
// Phase 0 で実際に入れたもの（2026-08 時点の最新安定版）
{
  "dependencies": {
    "next": "16.3.0",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "@prisma/client": "^7",
    "@prisma/adapter-pg": "^7",        // ★ Prisma 7 では必須
    "pg": "^8",
    "stripe": "^22",
    "zod": "^4",
    "date-fns": "^4",
    "clsx": "^2",
    "tailwind-merge": "^3",
    "lucide-react": "^1",              // アイコン
    "react-markdown": "^10",
    "remark-gfm": "^4",
    "rehype-sanitize": "^6"            // XSS 対策。必ず入れる
  },
  "devDependencies": {
    "typescript": "^5",
    "prisma": "^7",
    "tailwindcss": "^4",
    "eslint": "^9",
    "eslint-config-next": "16.3.0",
    "vitest": "^4",
    "tsx": "^4",
    "dotenv": "^17",
    "@types/pg": "^8"
  }
}
```

### 各フェーズで追加するもの

まだ入れていない。必要になったフェーズで入れる。

| パッケージ | フェーズ | 用途 |
|---|---|---|
| `next-auth@beta` + `@auth/prisma-adapter` | Phase 1 | 認証 |
| `resend` | Phase 1 | メール送信 |
| `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | Phase 2 | R2 への画像アップロード |
| `@playwright/test` | Phase 5 | E2E テスト |

**バージョンは実装再開時に改めて確認すること。** 上記は Phase 0 時点の実測値。
