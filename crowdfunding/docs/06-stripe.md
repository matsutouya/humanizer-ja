# 06. Stripe Connect 設計・決済フロー

このドキュメントが実装で一番ハマるところ。丁寧に読むこと。

---

## 1. なぜ Stripe Connect が必須か

支援金は「支援者 → 出品者」のお金であって、プラットフォームのお金ではない。
これを一度自分の口座に全額受け取ってから出品者に手動送金すると、**資金移動業や収納代行の論点**が出てくる。

Stripe Connect の **destination charge** を使えば、決済と同時に出品者の Stripe アカウントへ資金が振り分けられ、プラットフォームは手数料分だけを受け取る形になる。実装が楽なだけでなく、お金の流れの整理としても素直。

### アカウントタイプの選択

| タイプ | 本人確認 UI | 管理画面 | 採用 |
|---|---|---|---|
| Standard | Stripe | 出品者が自分の Stripe ダッシュボードを持つ | △ |
| **Express** | **Stripe が提供** | **簡易版を Stripe が提供** | **◎ これを使う** |
| Custom | 自前で全部作る | 自前 | ✕ 工数が跳ね上がる |

**Express 一択。** 本人確認書類の収集、銀行口座登録、税務情報の取得を Stripe が全部やってくれる。自作すると数ヶ月かかる。

---

## 2. お金の流れと手数料

### charge タイプ: destination charge を使う

```
支援者のカード
      │  ¥10,000
      ▼
┌─────────────────────────┐
│ プラットフォームの Stripe │  ← 決済はここに立つ（顧客との取引主体はプラットフォーム）
│  残高                    │
└──┬──────────────┬───────┘
   │              │
   │ Stripe 手数料 │ transfer（自動）
   │ ¥360 (3.6%)  │ ¥8,640
   ▼              ▼
 Stripe      出品者の Connect アカウント
                    │
                    ▼
              出品者の銀行口座
```

- `transfer_data.destination` = 出品者の Connect アカウント ID
- `application_fee_amount` = プラットフォームが受け取る額（円・整数）
- **Stripe 手数料はプラットフォーム側の残高から引かれる**（destination charge の場合）

### 手数料の決め方（重要）

destination charge では **Stripe 手数料をプラットフォームが負担する**。
つまり「プラットフォーム手数料 10%」と決めたなら、Stripe 手数料 3.6% を上乗せして `application_fee_amount` を 13.6% にしないと、実際の取り分は 6.4% になってしまう。

**推奨の設定:**

| 項目 | 率 | ¥10,000 の例 |
|---|---|---|
| 支援額 | 100% | ¥10,000 |
| application_fee_amount（Stripe に指定する額） | 13.6% | ¥1,360 |
| └ うち Stripe 決済手数料 | 3.6% | ¥360 |
| └ うちプラットフォーム取り分 | 10.0% | ¥1,000 |
| **出品者の受取額** | **86.4%** | **¥8,640** |

出品者への表示は CAMPFIRE 方式で分けて書くと納得されやすい:
> 手数料 13.6%（サービス利用料 10% + 決済手数料 3.6%）

### `lib/fees.ts`（手数料計算の唯一の置き場所）

```ts
/** 決済手数料率（ベーシスポイント）。Stripe JP のカード決済 3.6% */
export const PAYMENT_FEE_RATE_BP = 360

/** プラットフォーム手数料のデフォルト。プロジェクト作成時にスナップショットする */
export const DEFAULT_PLATFORM_FEE_RATE_BP = 1000  // 10.00%

export type FeeBreakdown = {
  totalAmount: number      // 支援総額
  applicationFee: number   // Stripe に渡す application_fee_amount
  platformFee: number      // うちプラットフォーム取り分
  paymentFee: number       // うち決済手数料
  creatorPayout: number    // 出品者受取額
}

export function calcFees(totalAmount: number, platformFeeRateBp: number): FeeBreakdown {
  const platformFee = Math.round((totalAmount * platformFeeRateBp) / 10_000)
  const paymentFee  = Math.round((totalAmount * PAYMENT_FEE_RATE_BP) / 10_000)
  const applicationFee = platformFee + paymentFee

  return {
    totalAmount,
    applicationFee,
    platformFee,
    paymentFee,
    // 端数のズレを出さないため、引き算で求める
    creatorPayout: totalAmount - applicationFee,
  }
}
```

**`creatorPayout` は必ず引き算で求める。** それぞれを独立に丸めると 1 円ズレて、集計が合わなくなる。

---

## 3. 出品者オンボーディング（Connect Express）

```
1. ユーザーが「出品者になる」→ CreatorProfile 作成 → 運営承認
2. /creator/payouts で「入金先を登録する」
3. サーバー: Account を作成（初回のみ）
4. サーバー: Account Link を発行
5. Stripe のホスト画面へリダイレクト（本人確認・口座登録）
6. 完了すると return_url に戻ってくる
7. Webhook `account.updated` で charges_enabled / payouts_enabled を同期
8. payouts_enabled が true になるまでプロジェクトを公開させない
```

```ts
// 3. アカウント作成
const account = await stripe.accounts.create({
  type: 'express',
  country: 'JP',
  email: user.email,
  capabilities: {
    card_payments: { requested: true },
    transfers:     { requested: true },
  },
  business_type: profile.isBusiness ? 'company' : 'individual',
  metadata: { creatorProfileId: profile.id },
})

// 4. オンボーディングリンク発行（有効期限が短いので毎回作る）
const link = await stripe.accountLinks.create({
  account: account.id,
  refresh_url: `${BASE_URL}/creator/payouts?refresh=1`,
  return_url:  `${BASE_URL}/creator/payouts?done=1`,
  type: 'account_onboarding',
})
// link.url へリダイレクト
```

**注意**
- Account Link は数分で失効する。DB に保存して使い回さない。毎回新規発行する。
- `return_url` に戻ってきても**完了したとは限らない**。必ず `stripe.accounts.retrieve()` か Webhook で状態を確認する。
- `requirements.currently_due` が空でなければ追加情報が必要。`RESTRICTED` として扱い、ダッシュボードに再開リンクを出す。

---

## 4. 支援フロー A: All-in（実行確定型）

**支援した瞬間に決済が完了する。** 実装が単純なのでまずこちらを作る。

```
支援者が [お支払いへ進む]
      │
      ▼
createPledgeCheckout（Server Action）
  ├─ 在庫確保・Pledge を PENDING で作成
  └─ Checkout Session を mode='payment' で作成
      │
      ▼
Stripe Checkout（Stripe のドメイン）でカード入力
      │
      ├─ 成功 → success_url へ戻る（表示だけ）
      │
      └─ Webhook `checkout.session.completed` ← ★ ここで確定処理をする
            ├─ Pledge を CAPTURED に
            ├─ Project.currentAmount / backerCount を加算
            └─ 支援完了メール送信
```

**成功判定は必ず Webhook で行う。** `success_url` へのリダイレクトはユーザーがブラウザを閉じたら発生しないし、URL を直接叩けば偽装できる。

```ts
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  customer: user.stripeCustomerId,
  line_items: [{
    price_data: {
      currency: 'jpy',
      unit_amount: fees.totalAmount,   // ★ サーバーで計算した額
      product_data: {
        name: `${project.title} - ${reward.title}`,
        description: reward.description.slice(0, 100),
      },
    },
    quantity: 1,
  }],
  payment_intent_data: {
    application_fee_amount: fees.applicationFee,
    transfer_data: { destination: creator.stripeAccountId },
    metadata: { pledgeId: pledge.id, projectId: project.id },
  },
  metadata: { pledgeId: pledge.id },
  success_url: `${BASE_URL}/pledge/complete?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url:  `${BASE_URL}/projects/${project.slug}?canceled=1`,
  expires_at: Math.floor(Date.now() / 1000) + 30 * 60,   // 30分
  locale: 'ja',
})
```

**JPY は最小通貨単位が「円」そのもの。** `unit_amount: 10000` は ¥10,000。100 倍しない（USD の感覚で書くと 100 倍請求される）。

> ⚠️ **ただし、上の `transfer_data` を使った即時送金は最終形ではない。**
> 決済と同時に出品者へ送金すると、返金・チャージバックの原資が消える（持ち逃げ・出品者残高不足）。
> **実装では `transfer_data` を指定せず、募集終了+7日にプロジェクト単位でまとめて `transfers.create` する。**
> 資金リスク対策とコスト削減が同じ実装で両立する。
> → [11-payment-hardening.md](11-payment-hardening.md) §8、[13-payment-cost.md](13-payment-cost.md) §2

---

## 5. 支援フロー B: All-or-Nothing（目標達成型）

**ここが一番難しい。**

### なぜオーソリ（与信確保）方式では作れないか

Stripe の `capture_method: 'manual'` によるオーソリは **最大7日で失効する**。
クラファンの募集期間は 30〜60 日が普通なので、締切時にはオーソリが全部切れている。**この方式は成立しない。**

### 正しい方式: カード保存 → 締切時に一括決済

```
【募集中】
支援者が [支援する]
      │
      ▼
Checkout Session を mode='setup' で作成（請求は発生しない）
      │
      ▼
Webhook `checkout.session.completed`
  ├─ SetupIntent から payment_method を取得
  ├─ Pledge に stripePaymentMethodId を保存
  ├─ Pledge を AUTHORIZED に
  └─ Project.currentAmount を加算（表示上は集まったことにする）

【締切時】Cron: /api/cron/close-projects
      │
      ├─ 目標達成 → AUTHORIZED の Pledge を1件ずつ off_session 決済
      │     成功 → CAPTURED
      │     失敗 → PAYMENT_FAILED（リトライ対象）
      │
      └─ 目標未達 → 全 Pledge を EXPIRED に、支援者へ「不成立」メール
                    （何も請求しない）
```

```ts
// 募集中: カード保存だけ
const session = await stripe.checkout.sessions.create({
  mode: 'setup',
  customer: user.stripeCustomerId,
  currency: 'jpy',
  payment_method_types: ['card'],
  metadata: { pledgeId: pledge.id },
  success_url: `${BASE_URL}/pledge/complete?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url:  `${BASE_URL}/projects/${project.slug}?canceled=1`,
  locale: 'ja',
})

// 締切時: 実際に請求
const pi = await stripe.paymentIntents.create({
  amount: pledge.totalAmount,
  currency: 'jpy',
  customer: user.stripeCustomerId,
  payment_method: pledge.stripePaymentMethodId,
  off_session: true,
  confirm: true,
  application_fee_amount: fees.applicationFee,
  transfer_data: { destination: creator.stripeAccountId },
  metadata: { pledgeId: pledge.id, projectId: project.id },
  idempotency_key: `pledge-capture-${pledge.id}`,   // ★ 二重請求防止
})
```

### 締切時決済で必ず起きる失敗と対処

| エラー | 原因 | 対処 |
|---|---|---|
| `authentication_required` | 3D セキュアの再認証が必要 | 支援者に「決済の確認をお願いします」メールを送り、Hosted Invoice か再決済ページで本人認証させる |
| `card_declined` (insufficient_funds) | 残高不足 | 3日おきに最大3回リトライ。並行してメール督促 |
| `expired_card` | カード期限切れ（30日以上経つと普通に起きる） | カード変更ページへ誘導 |

**成功率は 100% にならない。** 実務上は 90〜95% 程度と見ておく。
`Project.currentAmount` は募集中の「見込み額」であり、実際の入金額とは一致しないことを**出品者ダッシュボードに明記する**。ここを説明していないとクレームになる。

### 冪等キーは必ず付ける

Cron が二重に走ったり、途中で落ちて再実行されたときに**同じ人から二重に請求する事故**が起きる。
`idempotency_key: \`pledge-capture-${pledge.id}\`` を必ず指定する。これだけで防げる。

---

## 6. Webhook で処理するイベント

| イベント | 処理 |
|---|---|
| `checkout.session.completed` | **中核。** mode によって分岐。payment → CAPTURED / setup → AUTHORIZED + payment_method 保存 |
| `checkout.session.expired` | Pledge を CANCELED に、在庫を戻す |
| `payment_intent.succeeded` | 締切時決済の成功。CAPTURED に。`balance_transaction` から実際の Stripe 手数料を取得して記録 |
| `payment_intent.payment_failed` | PAYMENT_FAILED に。`last_payment_error` を保存。督促メール |
| `charge.refunded` | REFUNDED に。集計を減算 |
| `charge.dispute.created` | チャージバック。運営に緊急通知。**該当プロジェクトの入金を保留** |
| `account.updated` | Connect アカウントの `charges_enabled` / `payouts_enabled` / `requirements` を同期 |
| `transfer.created` | Payout レコードを IN_TRANSIT に |
| `payout.paid` / `payout.failed` | 出品者の銀行口座への着金結果 |

### 冪等性は必須

Stripe は**同じイベントを複数回送ってくることがある**（ネットワーク再送・リトライ）。
`WebhookEvent.stripeEventId` の unique 制約で二度目を弾く。これがないと支援額が二重加算される。

```ts
// 実装は 04-api.md の POST /api/webhooks/stripe を参照
```

さらに、状態遷移の処理も**べき等に書く**:

```ts
// ❌ ダメ: 二回走ると二重加算
await tx.project.update({ data: { currentAmount: { increment: amount } } })

// ✅ OK: 遷移前の状態を条件にする
const res = await tx.pledge.updateMany({
  where: { id: pledgeId, status: 'PENDING' },   // ★ PENDING のときだけ
  data:  { status: 'CAPTURED', capturedAt: new Date() },
})
if (res.count === 0) return   // すでに処理済み。何もしない
await tx.project.update({ data: { currentAmount: { increment: amount } } })
```

---

## 7. 返金

```ts
await stripe.refunds.create({
  payment_intent: pledge.stripePaymentIntentId,
  reverse_transfer: true,        // ★ 出品者に渡した分も引き戻す
  refund_application_fee: true,  // ★ 手数料も返す（運営都合の返金の場合）
})
```

- `reverse_transfer: true` を忘れると、**出品者に渡した金額をプラットフォームが被る**。
- 出品者の残高が不足していると引き戻しに失敗する。募集終了直後の返金は成功しやすいが、時間が経つほど回収不能リスクが上がる。**返金対応の期限を規約で定めておく。**
- 決済手数料 3.6% は返金しても Stripe から戻ってこない。運営都合の返金はプラットフォームの実損になる。

---

## 8. ローカルでの Webhook テスト

```bash
# Stripe CLI をインストール
brew install stripe/stripe-cli/stripe   # macOS
stripe login

# ローカルへ転送（出力される whsec_... を .env.local に入れる）
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# イベントを手動発火
stripe trigger checkout.session.completed
stripe trigger payment_intent.payment_failed
stripe trigger account.updated
```

### テストカード

| 番号 | 挙動 |
|---|---|
| `4242 4242 4242 4242` | 成功 |
| `4000 0025 0000 3155` | 3D セキュア認証が必要 |
| `4000 0000 0000 9995` | 残高不足で失敗 |
| `4000 0000 0000 0341` | 保存は成功するが後の決済で失敗（**AON のテストに必須**） |
| `4000 0000 0000 0259` | チャージバック（不正請求） |

有効期限は未来の任意の日付、CVC は任意の3桁。

### Connect のテスト

テストモードでは本人確認をスキップできる。オンボーディング画面で `000 000 0000` などのテスト値を入れると即完了する（Stripe が案内を出してくれる）。

---

## 8.5. ⚠️ Stripe の事前承認が必要（最重要）

> 調査日: 2026年8月。**このドキュメントの記述は二次情報。**
> 実行前に必ず Stripe の一次情報（利用制限業種のページと Connect 申込書）を直接確認すること。

### 結論: クラウドファンディングは「承認があれば使える」制限業種

**勝手に始めてはいけない。** Stripe の公開情報では、

- クラウドファンディングは**禁止業種ではない**が、**明示的な事前承認**を得た場合に限り利用できる制限業種として扱われている
- **「承認なしのクラウドファンディング」は、アカウントが制限される理由として明記されている**
- Stripe には「**承認済みクラウドファンディングプラットフォーム**」という正式な区分があり、
  承認を受けたプラットフォームが Connect を使って資金を集められる、という建て付けになっている

Kickstarter や Indiegogo も Connect を使っている。**道は開かれているが、申請が要る。**

### Connect を使わない選択肢は存在しない

他人（出品者）のためのお金を自社アカウントで受け取ると、**アグリゲーション**とみなされ規約違反になる。
これは [02-architecture.md](02-architecture.md) で Connect 必須と判断した理由そのもので、
**決済まわりの設計は最初からこの前提で組んである**（[11-payment-hardening.md](11-payment-hardening.md)）。

### 申請のタイミング

**アカウント開設と同時に Connect 申込書を出す。** 後回しにすると、
「気づいたら制限がかかっていた」という順番になりうる。

```
Stripe アカウント開設
   ↓ 同時に
Connect 申込書を提出（事業内容を詳しく書く）
   ↓
承認 → テスト実装を進める
却下 → 詳細な説明を添えて再申請（覆ることがある）
```

**却下されても終わりではない。** 個人開発者が一度アカウント閉鎖になり、
説明を添えて再申請したところ翌日に復活した事例が公開されている。
ただし**そもそも申請していなければ、その土俵にも乗れない。**

### 申請時に説明を求められること

[10-legal.md](10-legal.md) §6 と重なる。**規約類が未整備だと通らない。**

- [ ] 事業内容の詳細（購入型クラウドファンディングであること。投資・寄付ではない）
- [ ] **お金の流れ**（支援者 → Connect → 出品者。プラットフォームは手数料のみ）
- [ ] **資金を保持する期間と理由**（募集終了+7日。返金・チャージバック対応のため）
      → [11-payment-hardening.md](11-payment-hardening.md) §8 の送金遅延は**隠さず申告する**
- [ ] All-or-Nothing でカードを保存して後から請求する方式であること
- [ ] 出品者の審査プロセス（全件審査していること）
- [ ] リターン不履行時の対応方針
- [ ] 禁止プロジェクトのポリシー（[legal/guidelines.md](../legal/guidelines.md)）
- [ ] **公開済みの** 利用規約 / プライバシーポリシー / 特商法表記 の URL
- [ ] 想定取引額

### 日本での却下事例で多いもの

**特商法表記の不備。** 実例として、**電話番号の記載漏れ**で却下されたケースが報告されている。

- [ ] 特商法ページに**電話番号を記載する**（[decisions.md](../decisions.md) A-9。**未決定のまま進めない**）
- [ ] **特商法ページの事業者名・住所が、Stripe に登録した情報と一致している**こと
- [ ] 規約類が「これから作る」ではなく**公開済み**であること

### 高リスク業種としての扱い

クラウドファンディングは「商品提供が将来になる」ため、チャージバック率が高くなりやすい。
そのため承認されても、**入金保留（リザーブ）を設定される場合がある**。資金繰りに織り込んでおく。

**小規模なクラウドファンディングプラットフォームが制限を受けたという声も公開されている。**
承認が下りる保証はない。だからこそ、規約と審査体制を先に固めてから申請する。

### ロードマップへの反映

[08-roadmap.md](08-roadmap.md) の Phase 3 時点で「本番審査の準備開始」としているが、
**Connect 申込書はもっと早く、Phase 4（アカウント開設）と同時に出す。**

```
Phase 4  Stripe アカウント開設 ＋ Connect 申込書を同時提出  ← ここ
Phase 8  本番モードへの切り替え申請
```

---

## 9. 実装チェックリスト

決済まわりを実装したら、リリース前に必ずこれを全部確認する。

- [ ] `unit_amount` に 100 を掛けていない（JPY は倍率不要）
- [ ] 金額をクライアントから受け取っていない
- [ ] Webhook の署名検証をしている（生ボディを使っている）
- [ ] `WebhookEvent` の unique 制約で冪等性を担保している
- [ ] 状態遷移が `updateMany + where: { status: 前の状態 }` でべき等になっている
- [ ] 締切時決済に `idempotency_key` を付けている
- [ ] `transfer_data.destination` が正しい出品者の Connect アカウント ID
- [ ] `payouts_enabled === false` の出品者はプロジェクトを公開できない
- [ ] 返金時に `reverse_transfer: true` を指定している
- [ ] 在庫確保がトランザクション内の条件付き UPDATE になっている
- [ ] PENDING のまま放置された Pledge を Cron で解放している
- [ ] All-or-Nothing の支援画面に「今は請求されません」と明記している
- [ ] 出品者ダッシュボードに手数料と受取見込額を表示している
- [ ] 自分のプロジェクトへの自己支援を禁止している
- [ ] 本番キーがテスト環境に入っていない
- [ ] **Connect 申込書を提出し、クラウドファンディングとしての承認を得ている**（§8.5）
- [ ] 特商法ページに電話番号があり、Stripe の登録情報と一致している
