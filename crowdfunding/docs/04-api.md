# 04. API / Server Actions 設計

## 方針

- 画面から呼ぶ処理は基本 **Server Actions**。REST API は外部（Stripe / Cron）からの入口だけ作る。
- すべての Action は **`(1) 認証確認 → (2) Zod バリデーション → (3) 認可確認 → (4) service 呼び出し`** の4ステップで始める。順番を守る。
- 戻り値は `{ ok: true, data } | { ok: false, error, fieldErrors? }` の形に統一。例外を UI まで投げない。

```ts
// server/actions/_helper.ts のイメージ
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }
```

---

## 1. 認証系（Auth.js が担当）

| エンドポイント | 内容 |
|---|---|
| `POST /api/auth/signin/email` | マジックリンク送信 |
| `GET /api/auth/callback/*` | コールバック |
| `POST /api/auth/signout` | ログアウト |

Auth.js に任せるので自前実装なし。

---

## 2. Server Actions 一覧

### 2.1 プロフィール

| Action | 引数 | 認可 | 説明 |
|---|---|---|---|
| `updateProfile` | name, handle, bio, image, links | 本人 | プロフィール更新。handle は一意チェック |
| `deleteAccount` | — | 本人 | 論理削除。進行中の支援があれば拒否 |

### 2.2 出品者

| Action | 引数 | 認可 | 説明 |
|---|---|---|---|
| `applyAsCreator` | displayName, legalName, isBusiness, 自己紹介 | ログイン済み | 出品者申請。`CreatorProfile` を作成し `appliedAt` を打つ |
| `createConnectOnboardingLink` | — | CREATOR | Stripe Connect の Account Link を発行しリダイレクト URL を返す |
| `refreshConnectStatus` | — | CREATOR | Stripe から account を取得して `chargesEnabled` 等を同期 |

### 2.3 プロジェクト（出品者）

| Action | 引数 | 認可 | 説明 |
|---|---|---|---|
| `createProject` | title のみ | CREATOR + オンボ完了 | 下書きを作って編集画面へ |
| `updateProjectBasics` | title, tagline, categoryId, coverImageUrl, videoUrl | 所有者 & DRAFT/REJECTED | 基本情報 |
| `updateProjectStory` | description (Markdown) | 所有者 & LIVE でも可 | 本文。公開後も編集可 |
| `updateProjectFunding` | fundingType, goalAmount, startAt, endAt | 所有者 & **DRAFT/REJECTED のみ** | 資金条件。公開後は絶対に変更不可 |
| `submitForReview` | — | 所有者 & DRAFT/REJECTED | 必須項目チェック後 `IN_REVIEW` へ |
| `createReward` / `updateReward` / `deleteReward` | — | 所有者 | LIVE 後は**既存リターンの金額変更・削除は不可**、新規追加と在庫増は可 |
| `reorderRewards` | ids[] | 所有者 | 並び替え |
| `publishUpdate` | title, body, backersOnly | 所有者 & LIVE 以降 | 活動報告。支援者へメール通知 |
| `exportBackersCsv` | projectId | 所有者 & SUCCEEDED 以降 | 配送先 CSV。**成立前は住所を返さない** |

#### `updateProjectFunding` の禁止ルール（重要）

```ts
if (project.status !== 'DRAFT' && project.status !== 'REJECTED') {
  return { ok: false, error: '公開後は募集条件を変更できません' }
}
```

目標金額・終了日を後から変えられると支援者との約束が崩れる。UI で隠すだけでなく **サーバー側で必ず弾く**。

### 2.4 支援（支援者）

| Action | 引数 | 認可 | 説明 |
|---|---|---|---|
| `createPledgeCheckout` | projectId, rewardId, quantity, additionalTip, message, isAnonymous, shippingAddress? | ログイン済み | **最重要**。下記参照 |
| `cancelPledge` | pledgeId | 本人 & AON & 募集中 | 支援キャンセル。在庫を戻す |
| `postComment` | projectId, body | ログイン済み | 応援コメント |

#### `createPledgeCheckout` の処理順（これを間違えると事故る）

```
1. セッション確認 → 未ログインなら拒否
2. Zod バリデーション（quantity >= 1, additionalTip >= 0 など）
3. プロジェクト取得 → status === 'LIVE' && now < endAt を確認
4. リターン取得 → projectId 一致を確認（他プロジェクトのリターン ID を渡す攻撃を防ぐ）
5. ★ 金額はサーバーで計算する。クライアントから来た金額は一切信用しない
      rewardAmount  = reward.amount * quantity
      totalAmount   = rewardAmount + additionalTip
      platformFee   = calcPlatformFee(totalAmount, project.platformFeeRate)
6. 配送要リターンなら shippingAddress 必須チェック
7. トランザクション開始
     7-1. 条件付き UPDATE で在庫確保（更新0行なら SoldOutError）
     7-2. Pledge を PENDING で作成
8. Stripe Checkout Session 作成（All-in は mode=payment / AON は mode=setup）
9. Pledge に stripeCheckoutSessionId を保存
10. Checkout の URL を返す → クライアントでリダイレクト
```

**5番が一番大事。** 金額をクライアントから受け取ると、開発者ツールで 10000 円のリターンを 1 円で買われる。

### 2.5 運営

| Action | 引数 | 認可 | 説明 |
|---|---|---|---|
| `approveProject` | projectId | ADMIN | `SCHEDULED` or `LIVE` へ。出品者へメール |
| `rejectProject` | projectId, comment | ADMIN | `REJECTED` へ。理由必須 |
| `suspendProject` | projectId, reason | ADMIN | `SUSPENDED` へ。募集停止 |
| `approveCreator` / `rejectCreator` | userId | ADMIN | 出品者申請の審査 |
| `refundPledge` | pledgeId, reason | ADMIN | Stripe 返金 + トランスファー巻き戻し |
| `hideComment` | commentId | ADMIN | コメント非表示 |
| `resolveReport` | reportId, resolution | ADMIN | 通報対応 |

---

## 3. REST API（外部からの入口）

### `POST /api/webhooks/stripe`

Stripe からの Webhook 受け口。詳細は [06-stripe.md](06-stripe.md)。

```ts
export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature')
  const body = await req.text()          // ★ 生ボディが必要。req.json() を使わない

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig!, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return new Response('Invalid signature', { status: 400 })
  }

  // 冪等性: 既に処理済みなら即 200
  const existing = await prisma.webhookEvent.findUnique({ where: { stripeEventId: event.id } })
  if (existing?.processedAt) return new Response('OK', { status: 200 })

  await prisma.webhookEvent.upsert({
    where:  { stripeEventId: event.id },
    create: { stripeEventId: event.id, type: event.type, payload: event as any },
    update: {},
  })

  await handleStripeEvent(event)

  await prisma.webhookEvent.update({
    where: { stripeEventId: event.id },
    data:  { processedAt: new Date() },
  })

  return new Response('OK', { status: 200 })
}
```

**注意点**
- Next.js の Route Handler では `await req.text()` で生ボディを取る。パース済み JSON では署名検証が通らない。
- 処理に失敗したら 500 を返す。Stripe が自動リトライしてくれる。
- **200 を返すまでの処理は短くする**（Stripe のタイムアウトは 20 秒）。重い処理はフラグだけ立てて Cron に回す。

### `POST /api/cron/close-projects`

毎時実行。`endAt` を過ぎた `LIVE` プロジェクトを締める。

```
1. status=LIVE かつ endAt <= now のプロジェクトを取得
2. ALL_IN         → status=SUCCEEDED（決済はすでに完了済み）
3. ALL_OR_NOTHING →
     currentAmount >= goalAmount なら
       status=SUCCEEDED、AUTHORIZED の Pledge を順に off_session で決済
     未達なら
       status=FAILED、AUTHORIZED の Pledge を EXPIRED に、支援者へメール
4. Payout レコードを作成
```

### `POST /api/cron/retry-payments`

1日1回。`PAYMENT_FAILED` の Pledge を再決済。3回失敗したら諦めて出品者に通知。

### `POST /api/cron/release-stale-pledges`

15分ごと。`PENDING` のまま30分経過した Pledge をキャンセルし、確保していた在庫を戻す。

### `POST /api/upload`

画像アップロード。R2 への署名付き URL を返す方式にする（サーバーを経由させない）。

```
検証: MIME (image/jpeg|png|webp) / サイズ 5MB 以下 / ログイン済み
```

**Cron の保護**: `Authorization: Bearer ${CRON_SECRET}` を必須にする。Vercel Cron は自動でこのヘッダを付けられる。付けないと誰でも叩けてしまう。

---

## 4. 認可ルール表

`lib/permissions.ts` に集約する。

| 操作 | 条件 |
|---|---|
| プロジェクト閲覧 | `status ∈ {LIVE, SUCCEEDED, FAILED, FULFILLING, COMPLETED}` または 所有者 または ADMIN |
| プロジェクト編集 | 所有者 かつ `status ∈ {DRAFT, REJECTED}`（本文のみ LIVE 以降も可） |
| 支援 | ログイン済み かつ `status === LIVE` かつ `now < endAt` かつ 本人が出品者でない |
| 活動報告（限定公開）閲覧 | 支援者（CAPTURED 以上の Pledge を持つ） または 所有者 または ADMIN |
| 配送先住所の閲覧 | 所有者 かつ プロジェクトが `SUCCEEDED` 以降 |
| 支援者一覧の閲覧 | 所有者 または ADMIN |
| 全 ADMIN 操作 | `role === ADMIN` |

**自分のプロジェクトへの自己支援は禁止する。** 資金洗浄・手数料操作の温床になる。

---

## 5. エラーハンドリング方針

| 状況 | 挙動 |
|---|---|
| 在庫切れ | `{ ok: false, error: 'このリターンは売り切れました' }` + 画面リロード促し |
| 募集終了後の支援 | `{ ok: false, error: '募集期間が終了しました' }` |
| Stripe API エラー | ログに記録し、ユーザーには「決済処理に失敗しました。時間をおいて再度お試しください」 |
| Webhook 処理エラー | 500 を返して Stripe にリトライさせる。`WebhookEvent.error` に記録 |
| 認可エラー | 404 を返す（403 だと「存在はする」ことが漏れる） |

**エラーメッセージに内部情報（SQL・Stripe の生エラー・スタックトレース）を出さない。**
