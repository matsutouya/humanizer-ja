# 03. DB スキーマ

そのまま `prisma/schema.prisma` に貼れる形で書いてある。

## 設計方針

- **金額はすべて `Int`（円）**。小数は使わない。
- **削除は原則論理削除**（`deletedAt`）。会計記録が絡むため物理削除しない。
- **集計値（現在の支援額・支援者数）は非正規化してキャッシュする**。プロジェクト詳細は最も見られるページなので、毎回 SUM するのは避ける。更新はトランザクション内で行う。
- **Stripe の ID は必ず保持**。突き合わせができないと事故ったとき詰む。
- **日時はすべて UTC 保存**。表示時に JST 変換する。

---

## ER 図（主要部分）

```
User ──1:1── CreatorProfile
 │                │
 │                └──1:N── Project ──1:N── Reward
 │                            │  │            │
 │                            │  ├──1:N── ProjectUpdate
 │                            │  ├──1:N── ProjectImage
 │                            │  └──1:N── Comment
 │                            │
 └──1:N── Pledge ─────────────┘
             │
             ├──N:1── Reward
             └──1:1── ShippingAddress

Project ──N:1── Category
Project ──1:N── Payout
```

---

## Prisma スキーマ

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ══════════════════════════════════════════════════
//  Enums
// ══════════════════════════════════════════════════

enum UserRole {
  BACKER   // 一般会員（デフォルト）
  CREATOR  // 出品者（承認済み）
  ADMIN    // 運営
}

enum FundingType {
  ALL_IN           // 実行確定型：未達でも受け取る
  ALL_OR_NOTHING   // 目標達成型：達成時のみ決済
}

enum ProjectStatus {
  DRAFT       // 下書き（出品者が編集中）
  IN_REVIEW   // 審査中（編集ロック）
  REJECTED    // 差戻し（理由付きで DRAFT に戻せる）
  SCHEDULED   // 承認済み・公開待ち（開始日前）
  LIVE        // 募集中
  SUCCEEDED   // 成立（決済完了）
  FAILED      // 不成立（AON で未達）
  FULFILLING  // リターン履行中
  COMPLETED   // 完了
  SUSPENDED   // 運営により強制停止
}

enum PledgeStatus {
  PENDING          // Checkout 作成済み・未完了
  AUTHORIZED       // AON: カード保存済み・決済待ち
  CAPTURED         // 決済完了
  PAYMENT_FAILED   // 締切時の決済失敗（リトライ対象）
  CANCELED         // 支援者/出品者によるキャンセル
  REFUNDED         // 返金済み
  EXPIRED          // AON 不成立により無効化
}

enum PayoutStatus {
  PENDING
  IN_TRANSIT
  PAID
  FAILED
}

enum CreatorOnboardingStatus {
  NOT_STARTED
  IN_PROGRESS     // Stripe オンボーディング途中
  RESTRICTED      // 追加情報が必要
  COMPLETE        // 入金可能
}

// ══════════════════════════════════════════════════
//  Auth.js 標準モデル
// ══════════════════════════════════════════════════

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

// ══════════════════════════════════════════════════
//  ユーザー
// ══════════════════════════════════════════════════

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  emailVerified DateTime?
  name          String?
  handle        String?   @unique   // URL 用の一意な識別子 (@handle)
  image         String?
  bio           String?   @db.Text
  websiteUrl    String?
  twitterHandle String?
  role          UserRole  @default(BACKER)

  // 支援者としての Stripe Customer（カード保存に使う）
  stripeCustomerId String? @unique

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  accounts       Account[]
  sessions       Session[]
  creatorProfile CreatorProfile?
  pledges        Pledge[]
  comments       Comment[]
  reports        Report[]        @relation("Reporter")

  @@index([role])
}

/// 出品者としての情報。CREATOR に昇格したユーザーだけが持つ。
model CreatorProfile {
  id     String @id @default(cuid())
  userId String @unique
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  displayName String   // 出品者名（個人名・団体名）
  legalName   String?  // 特商法表記用の氏名
  isBusiness  Boolean  @default(false)

  // Stripe Connect
  stripeAccountId    String?                 @unique
  onboardingStatus   CreatorOnboardingStatus @default(NOT_STARTED)
  chargesEnabled     Boolean                 @default(false)
  payoutsEnabled     Boolean                 @default(false)

  // 出品者申請
  appliedAt   DateTime?
  approvedAt  DateTime?
  approvedBy  String?
  rejectedAt  DateTime?
  rejectReason String?  @db.Text

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  projects Project[]

  @@index([onboardingStatus])
}

// ══════════════════════════════════════════════════
//  プロジェクト
// ══════════════════════════════════════════════════

model Category {
  id        String    @id @default(cuid())
  slug      String    @unique   // "music", "art", "game"...
  name      String              // "音楽", "アート"...
  emoji     String?
  sortOrder Int       @default(0)
  projects  Project[]
}

model Project {
  id        String @id @default(cuid())
  slug      String @unique   // URL: /projects/[slug]
  creatorId String
  creator   CreatorProfile @relation(fields: [creatorId], references: [id])

  categoryId String?
  category   Category? @relation(fields: [categoryId], references: [id])

  // 基本情報
  title         String
  tagline       String   @db.VarChar(120)  // カード・OGP に出る一行説明
  description   String   @db.Text          // Markdown 本文
  coverImageUrl String?
  videoUrl      String?                    // YouTube 埋め込み URL

  // 資金調達条件（公開後は変更不可）
  fundingType FundingType @default(ALL_IN)
  goalAmount  Int                          // 目標金額（円）
  startAt     DateTime
  endAt       DateTime

  // 状態
  status      ProjectStatus @default(DRAFT)
  publishedAt DateTime?
  closedAt    DateTime?

  // 審査
  submittedAt   DateTime?
  reviewedAt    DateTime?
  reviewedBy    String?
  reviewComment String?   @db.Text

  // 集計キャッシュ（トランザクション内で更新）
  currentAmount Int @default(0)  // CAPTURED + AUTHORIZED の合計
  backerCount   Int @default(0)
  viewCount     Int @default(0)

  // 手数料率（プロジェクト単位で固定。後から率を変えても既存案件に影響させない）
  platformFeeRate Int @default(1000)  // ベーシスポイント: 1000 = 10.00%

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  rewards  Reward[]
  pledges  Pledge[]
  updates  ProjectUpdate[]
  images   ProjectImage[]
  comments Comment[]
  payouts  Payout[]
  reports  Report[]

  @@index([status, endAt])
  @@index([categoryId, status])
  @@index([creatorId])
  @@index([status, currentAmount])   // 人気順ソート用
}

model ProjectImage {
  id        String  @id @default(cuid())
  projectId String
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  url       String
  alt       String?
  sortOrder Int     @default(0)

  @@index([projectId])
}

model Reward {
  id        String  @id @default(cuid())
  projectId String
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  title       String
  description String @db.Text
  amount      Int              // 支援金額（円）
  imageUrl    String?

  // 数量制限（null = 無制限）
  quantityLimit   Int?
  quantityClaimed Int @default(0)

  estimatedDeliveryAt DateTime?  // お届け予定（月初日を入れる運用）
  shippingRequired    Boolean    @default(false)

  sortOrder Int       @default(0)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  pledges Pledge[]

  @@index([projectId, sortOrder])
}

model ProjectUpdate {
  id        String  @id @default(cuid())
  projectId String
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  title       String
  body        String  @db.Text
  backersOnly Boolean @default(false)   // 支援者限定公開

  publishedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([projectId, publishedAt])
}

model Comment {
  id        String  @id @default(cuid())
  projectId String
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  userId    String
  user      User    @relation(fields: [userId], references: [id])

  body     String   @db.Text
  isHidden Boolean  @default(false)   // 運営による非表示

  createdAt DateTime  @default(now())
  deletedAt DateTime?

  @@index([projectId, createdAt])
}

// ══════════════════════════════════════════════════
//  支援・決済
// ══════════════════════════════════════════════════

model Pledge {
  id        String  @id @default(cuid())
  projectId String
  project   Project @relation(fields: [projectId], references: [id])
  backerId  String
  backer    User    @relation(fields: [backerId], references: [id])
  rewardId  String?
  reward    Reward? @relation(fields: [rewardId], references: [id])

  // 金額の内訳（すべて円）
  rewardAmount   Int          // リターン価格 × 数量
  additionalTip  Int @default(0)  // 上乗せ支援
  totalAmount    Int          // rewardAmount + additionalTip
  platformFee    Int          // プラットフォーム手数料
  stripeFee      Int @default(0)  // Stripe 手数料（Webhook で確定後に記録）
  creatorPayout  Int          // 出品者受取見込み額

  quantity Int @default(1)

  status PledgeStatus @default(PENDING)

  // Stripe
  stripeCheckoutSessionId String? @unique
  stripePaymentIntentId   String? @unique
  stripeSetupIntentId     String? @unique   // AON 用
  stripePaymentMethodId   String?           // AON: 締切時に使うカード
  stripeChargeId          String?
  stripeRefundId          String?

  // 決済リトライ
  paymentAttempts     Int       @default(0)
  lastPaymentError    String?   @db.Text
  lastPaymentAttemptAt DateTime?

  // 支援者からのメッセージ
  supporterMessage String?  @db.Text
  isAnonymous      Boolean  @default(false)

  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  capturedAt DateTime?
  canceledAt DateTime?
  refundedAt DateTime?

  shippingAddress ShippingAddress?

  @@index([projectId, status])
  @@index([backerId, createdAt])
  @@index([status, createdAt])
}

model ShippingAddress {
  id       String @id @default(cuid())
  pledgeId String @unique
  pledge   Pledge @relation(fields: [pledgeId], references: [id], onDelete: Cascade)

  recipientName String
  postalCode    String
  prefecture    String
  city          String
  addressLine1  String
  addressLine2  String?
  phoneNumber   String

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

/// 出品者への入金記録。Stripe Connect のトランスファーを追跡する。
model Payout {
  id        String  @id @default(cuid())
  projectId String
  project   Project @relation(fields: [projectId], references: [id])

  grossAmount   Int          // 支援総額
  platformFee   Int          // プラットフォーム手数料
  stripeFee     Int          // Stripe 手数料
  netAmount     Int          // 出品者受取額

  status            PayoutStatus @default(PENDING)
  stripeTransferId  String?      @unique
  stripePayoutId    String?
  arrivalDate       DateTime?
  failureReason     String?      @db.Text

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([projectId])
  @@index([status])
}

// ══════════════════════════════════════════════════
//  運営・システム
// ══════════════════════════════════════════════════

/// Stripe Webhook の冪等性を保証する。同じ event.id は二度処理しない。
model WebhookEvent {
  id            String   @id @default(cuid())
  stripeEventId String   @unique
  type          String
  payload       Json
  processedAt   DateTime?
  error         String?  @db.Text
  createdAt     DateTime @default(now())

  @@index([type, createdAt])
}

model Report {
  id         String  @id @default(cuid())
  projectId  String
  project    Project @relation(fields: [projectId], references: [id])
  reporterId String?
  reporter   User?   @relation("Reporter", fields: [reporterId], references: [id])

  reason      String
  detail      String?   @db.Text
  resolvedAt  DateTime?
  resolvedBy  String?
  resolution  String?   @db.Text

  createdAt DateTime @default(now())

  @@index([resolvedAt])
}
```

---

## 重要な補足

### 集計キャッシュ（`Project.currentAmount` / `backerCount`）の更新

必ずトランザクション内で Pledge の状態変更と同時に更新する。

```ts
await prisma.$transaction(async (tx) => {
  await tx.pledge.update({ where: { id }, data: { status: 'CAPTURED', capturedAt: new Date() } })
  await tx.project.update({
    where: { id: projectId },
    data: {
      currentAmount: { increment: totalAmount },
      backerCount:   { increment: 1 },
    },
  })
})
```

定期的に実際の SUM と突き合わせて補正するバッチも用意しておくと安全（週1で十分）。

### リターン在庫の競合対策

`quantityClaimed` の更新は**条件付き UPDATE で行い、更新行数0なら在庫切れとして弾く**。
アプリ側で「SELECT して比較してから UPDATE」をやると、同時アクセスで上限を超える。

```ts
const updated = await tx.$executeRaw`
  UPDATE "Reward"
  SET "quantityClaimed" = "quantityClaimed" + ${qty}
  WHERE id = ${rewardId}
    AND ("quantityLimit" IS NULL OR "quantityClaimed" + ${qty} <= "quantityLimit")
`
if (updated === 0) throw new SoldOutError()
```

在庫は **Checkout セッション作成時に確保し、30分以内に完了しなければ解放する**（Cron で PENDING の期限切れを掃除）。

### `platformFeeRate` をプロジェクトに持つ理由

将来手数料率を変えたとき、募集中の既存プロジェクトの条件が勝手に変わると重大なトラブルになる。
プロジェクト作成時にその時点の率をスナップショットして固定する。

### なぜ `Pledge.stripeFee` は後から入るか

Stripe 手数料の確定額は Charge の `balance_transaction` を取得しないと分からない。
Webhook で `payment_intent.succeeded` を受けた後に取得して記録する。初期値0のままでも致命的ではない（管理画面の表示精度の問題）。

---

## seed データ（開発用）

`prisma/seed.ts` で最低限これを入れる:

- カテゴリ 8件（音楽 / アート / ゲーム / テクノロジー / フード / 出版 / 映像 / 地域）
- ADMIN ユーザー 1件（自分のメールアドレス）
- CREATOR ユーザー 2件 + Stripe Connect 未接続状態
- LIVE プロジェクト 5件（達成率 0% / 30% / 80% / 100% / 250% の見本。進捗バーの見え方確認用）
- 各プロジェクトにリターン 3〜5件（うち1件は在庫切れ）
- 支援 20件程度
