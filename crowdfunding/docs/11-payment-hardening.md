# 11. 決済の堅牢化設計

[06-stripe.md](06-stripe.md) が「どう決済を通すか」なら、これは **「1円もズレさせないための設計」**。
決済システムの事故は、バグではなく**お金の不整合**という形で表に出る。しかも気づくのが数週間後で、そのときには誰にいくら返せばいいか分からなくなっている。それを構造で防ぐ。

---

## 0. 設計の背骨（この4つを守れば大半の事故は防げる）

| # | 原則 | 具体化 |
|---|---|---|
| 1 | **お金の動きは複式簿記の台帳に必ず記帳する** | `LedgerEntry` に append-only で記録。集計値は台帳から導出できること |
| 2 | **状態遷移は明示的に定義し、それ以外を許さない** | 遷移表を定数で持ち、DB 更新は「遷移前の状態」を条件に含める |
| 3 | **すべての外部呼び出しと副作用は冪等** | 冪等キー + unique 制約 + Outbox |
| 4 | **毎日、外部（Stripe）と突き合わせる** | 照合バッチ。ズレたらアラート。**気づける仕組みが最重要** |

「テストを厚くする」は5番目。上の4つは構造で、テストは検査。**構造で防げないものをテストで防ごうとすると必ず漏れる。**

---

## 1. 台帳（Ledger）— これが中核

### なぜ必要か

`Project.currentAmount` や `Pledge.totalAmount` だけでは、次の質問に答えられない。

- 「今、出品者Aに支払うべき残高はいくらか」
- 「先月のプラットフォーム売上はいくらか」
- 「Stripe の残高とアプリの計算が¥1,240 ズレている。どこで？」
- 「このチャージバックの損失は誰が被ったか」

これらは**残高（state）だけ持っていると答えられず、取引履歴（journal）が要る**。後から足そうとすると過去分を再構成できないので、**最初から入れる**。

### 勘定科目

```ts
export const ACCOUNT = {
  PLATFORM_CASH:     'PLATFORM_CASH',      // Stripe プラットフォーム残高（資産）
  CREATOR_PAYABLE:   'CREATOR_PAYABLE',    // 出品者への未払金（負債）※ creatorId 付き
  PLATFORM_REVENUE:  'PLATFORM_REVENUE',   // 手数料収益（収益）
  PSP_FEE_PAYABLE:   'PSP_FEE_PAYABLE',    // Stripe 手数料の未払（負債）
  PSP_FEE_EXPENSE:   'PSP_FEE_EXPENSE',    // Stripe 手数料（費用）
  REFUND_EXPENSE:    'REFUND_EXPENSE',     // 返金で回収できなかった分（費用）
  DISPUTE_LOSS:      'DISPUTE_LOSS',       // チャージバック損失（費用）
} as const
```

### 記帳ルール

**符号付き金額で持ち、1つの仕訳（Journal）の合計は必ず 0。** これが唯一かつ絶対の不変条件。

#### 例: ¥10,000 の支援が決済された（手数料 13.6%）

| 勘定 | 金額 | 意味 |
|---|---:|---|
| `PLATFORM_CASH` | +10,000 | Stripe 残高に入った |
| `CREATOR_PAYABLE:creator_x` | −8,640 | 出品者への未払が増えた |
| `PLATFORM_REVENUE` | −1,000 | 手数料収益 |
| `PSP_FEE_PAYABLE` | −360 | Stripe に払う分 |
| **合計** | **0** | ✅ |

#### 例: Stripe 手数料が実際に引かれた（balance_transaction 確定時）

| 勘定 | 金額 |
|---|---:|
| `PSP_FEE_PAYABLE` | +360 |
| `PSP_FEE_EXPENSE` | −360 |
| `PLATFORM_CASH` | −360 |
| `PSP_FEE_PAYABLE`（相殺） | +360 |

※ 実装上は「手数料見込 → 確定」の差額調整仕訳を切る。**見込と実額がズレたら差額を必ず記帳する**（無視して上書きすると台帳が壊れる）。

#### 例: 出品者へ送金された（transfer.created）

| 勘定 | 金額 |
|---|---:|
| `CREATOR_PAYABLE:creator_x` | +8,640 |
| `PLATFORM_CASH` | −8,640 |

#### 例: 全額返金した（運営都合・手数料も返す）

| 勘定 | 金額 |
|---|---:|
| `PLATFORM_CASH` | −10,000 |
| `CREATOR_PAYABLE:creator_x` | +8,640 |
| `PLATFORM_REVENUE` | +1,000 |
| `REFUND_EXPENSE` | −360 | ← **Stripe 手数料は返ってこない。ここがプラットフォームの実損** |

この最後の行があるから、「返金するほど赤字が積もる」ことが数字で見える。

### スキーマ

```prisma
enum JournalType {
  PLEDGE_CAPTURE
  PSP_FEE_SETTLE
  FEE_ADJUSTMENT
  TRANSFER_TO_CREATOR
  REFUND
  DISPUTE_OPEN
  DISPUTE_WON
  DISPUTE_LOST
  MANUAL_ADJUSTMENT   // 運営による手修正。必ず理由と操作者を残す
}

/// 仕訳ヘッダ。1つの経済事象 = 1レコード。
model LedgerJournal {
  id   String      @id @default(cuid())
  type JournalType

  /// 冪等性の要。"stripe_evt_xxx" や "pledge-capture-<id>" を入れる。
  /// 同じ事象で二度記帳しようとすると unique 制約で弾かれる。
  externalRef String @unique

  pledgeId  String?
  projectId String?
  memo      String?  @db.Text

  /// MANUAL_ADJUSTMENT のときのみ必須
  operatorId String?

  occurredAt DateTime           // 経済事象が起きた時刻（Stripe 側の時刻）
  createdAt  DateTime @default(now())  // 記帳した時刻

  entries LedgerEntry[]

  @@index([type, occurredAt])
  @@index([pledgeId])
  @@index([projectId])
}

/// 仕訳明細。append-only。UPDATE / DELETE は絶対にしない。
model LedgerEntry {
  id        String        @id @default(cuid())
  journalId String
  journal   LedgerJournal @relation(fields: [journalId], references: [id])

  account   String        // ACCOUNT の値
  subjectId String?       // creatorId など。勘定の内訳キー
  amount    Int           // 符号付き（円）。プラス=借方、マイナス=貸方
  currency  String        @default("JPY")

  createdAt DateTime @default(now())

  @@index([account, subjectId])
  @@index([journalId])
}
```

### 記帳ヘルパー（必ずこれ経由で書く）

```ts
type EntryInput = { account: string; subjectId?: string; amount: number }

export async function postJournal(
  tx: Prisma.TransactionClient,
  input: {
    type: JournalType
    externalRef: string
    occurredAt: Date
    entries: EntryInput[]
    pledgeId?: string; projectId?: string; memo?: string; operatorId?: string
  }
) {
  const sum = input.entries.reduce((a, e) => a + e.amount, 0)
  if (sum !== 0) {
    throw new Error(`Unbalanced journal: sum=${sum} ref=${input.externalRef}`)
  }
  if (input.entries.length < 2) {
    throw new Error(`Journal needs >= 2 entries: ${input.externalRef}`)
  }
  if (input.type === 'MANUAL_ADJUSTMENT' && !input.operatorId) {
    throw new Error('Manual adjustment requires operatorId')
  }

  try {
    return await tx.ledgerJournal.create({
      data: { ...input, entries: { create: input.entries } },
    })
  } catch (e) {
    if (isUniqueViolation(e, 'externalRef')) return null  // 記帳済み。冪等に成功扱い
    throw e
  }
}
```

**`sum !== 0` を実行時に必ず検証する。** 型では防げない。ここで例外を投げればトランザクションごとロールバックされ、壊れたデータが残らない。

### DB レベルでも守る

マイグレーションに raw SQL を足して、アプリのバグをすり抜けさせない。

```sql
-- 台帳は更新・削除を禁止する
CREATE OR REPLACE FUNCTION ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LedgerEntry is append-only';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_no_update BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

-- 金額は 0 を許さない（意味のない明細を防ぐ）
ALTER TABLE "LedgerEntry" ADD CONSTRAINT amount_nonzero CHECK (amount <> 0);
```

**間違えたら「訂正仕訳を切る」。過去のレコードは書き換えない。** これが会計の作法で、監査可能性の根拠になる。

---

## 2. 状態機械を明示的に持つ

`if (status === 'X')` を各所に散らすと、必ずどこかで漏れる。**遷移表を1箇所に定義**して、そこを通らない状態変更を禁止する。

```ts
export const PLEDGE_TRANSITIONS: Record<PledgeStatus, PledgeStatus[]> = {
  PENDING:        ['AUTHORIZED', 'CAPTURED', 'CANCELED', 'EXPIRED'],
  AUTHORIZED:     ['CAPTURED', 'PAYMENT_FAILED', 'CANCELED', 'EXPIRED'],
  PAYMENT_FAILED: ['CAPTURED', 'EXPIRED', 'CANCELED'],   // リトライ成功 or 諦め
  CAPTURED:       ['REFUNDED'],                          // ★ ここから戻れるのは返金だけ
  CANCELED:       [],
  EXPIRED:        [],
  REFUNDED:       [],
}
```

### 遷移は「条件付き UPDATE」でしか行わない

```ts
export async function transitionPledge(
  tx: Prisma.TransactionClient,
  pledgeId: string,
  from: PledgeStatus[],       // 許容する遷移元
  to: PledgeStatus,
  data: Prisma.PledgeUpdateManyMutationInput = {}
): Promise<boolean> {
  for (const f of from) {
    if (!PLEDGE_TRANSITIONS[f].includes(to)) {
      throw new Error(`Illegal transition ${f} -> ${to}`)   // 開発時に気づく
    }
  }
  const res = await tx.pledge.updateMany({
    where: { id: pledgeId, status: { in: from } },   // ★ 楽観ロック相当
    data:  { status: to, ...data },
  })
  return res.count === 1     // false = すでに処理済み / 想定外の状態
}
```

呼び出し側は **`false` を「エラー」ではなく「すでに誰かがやった」として扱う**。これで Webhook の重複・Cron の二重起動が自然に無害化される。

```ts
const moved = await transitionPledge(tx, pledgeId, ['PENDING'], 'CAPTURED', { capturedAt: now })
if (!moved) return   // 冪等。何もしないで正常終了
await postJournal(tx, { ... })
await bumpProjectAggregate(tx, ...)
```

**金額の加算は必ず `moved === true` の後ろに置く。** これを守るだけで二重計上が構造的に起きなくなる。

同じ考え方を `Project.status` にも適用する（`LIVE → SUCCEEDED` は許すが `SUCCEEDED → LIVE` は禁止、など）。

---

## 3. Webhook の堅牢化

[06-stripe.md](06-stripe.md) の署名検証・冪等性に加えて、**実運用で必ず踏む3つの罠**に対処する。

### 罠1: イベントは順番どおりに届かない

`payment_intent.succeeded` より先に `charge.refunded` が届くことがある。ネットワーク再送とリトライで順序は保証されない。

**対策: 順序に依存しない設計にする。**
- 状態機械の遷移表で「戻れない遷移」を禁止しているので、古いイベントは `updateMany` が 0 件になって自然に無視される
- どうしても順序が要る場合は `event.created` を比較する

```prisma
model Pledge {
  // ...
  lastStripeEventAt DateTime?   // 適用済みイベントのうち最新の created
}
```

```ts
if (pledge.lastStripeEventAt && event.created * 1000 < +pledge.lastStripeEventAt) {
  return   // 古いイベント。無視
}
```

### 罠2: Webhook の中で重い処理をすると Stripe がタイムアウトする

Stripe のタイムアウトは約20秒。メール送信・画像生成・外部 API を Webhook 内で同期実行すると、遅延で 500 になり、Stripe が再送し、二重処理の温床になる。

**対策: Outbox パターン。** Webhook では「DB を更新する」ことだけをやり、副作用は同じトランザクションでキューに積む。

```prisma
enum OutboxStatus { PENDING PROCESSING DONE FAILED }

model OutboxMessage {
  id        String       @id @default(cuid())
  topic     String       // "mail.pledge_completed" など
  payload   Json
  status    OutboxStatus @default(PENDING)
  attempts  Int          @default(0)
  lastError String?      @db.Text
  runAfter  DateTime     @default(now())   // 指数バックオフ用
  createdAt DateTime     @default(now())

  /// 同じ通知を二度送らないためのキー
  dedupeKey String? @unique

  @@index([status, runAfter])
}
```

```ts
// Webhook 内（トランザクション）
await tx.outboxMessage.create({
  data: {
    topic: 'mail.pledge_completed',
    payload: { pledgeId },
    dedupeKey: `mail.pledge_completed:${pledgeId}`,   // ★ 二重送信を DB で防ぐ
  },
})
// → 即 200 を返す。メールは Cron（1分ごと）が送る
```

**利点が大きい:** DB 更新とメール送信が原子的になる。「決済は成功したのにメールが飛ばない」「メールは飛んだのに DB が巻き戻った」が起きない。

### 罠3: Webhook が届かないことがある

Stripe が全リトライに失敗した、エンドポイントが長時間落ちていた、署名シークレットを間違えていた等。**Webhook を唯一の情報源にしてはいけない。**

**対策: 補完ポーリング。** 1時間ごとに、`PENDING` のまま30分以上経過した Pledge について Stripe に直接問い合わせて状態を同期する。

```ts
// /api/cron/sync-stale-pledges
for (const p of stalePledges) {
  const session = await stripe.checkout.sessions.retrieve(p.stripeCheckoutSessionId!)
  if (session.payment_status === 'paid') {
    await capturePledge(p.id, session)   // Webhook と同じ関数を呼ぶ（冪等なので安全）
  }
}
```

**Webhook 処理と補完ポーリングは同じ関数を呼ぶ。** 別実装にすると挙動がズレる。

---

## 4. 整合性チェック（毎日走らせる）

**バグは必ず出る。大事なのは「出たことに気づけるか」。** 以下を毎日 1 回実行し、1件でも不一致があれば運営に通知する。

```ts
// /api/cron/reconcile
const checks = [
  // 1. すべての仕訳が balance している
  { name: 'journal_balanced', sql: `
      SELECT j.id, SUM(e.amount) AS s FROM "LedgerJournal" j
      JOIN "LedgerEntry" e ON e."journalId" = j.id
      GROUP BY j.id HAVING SUM(e.amount) <> 0` },

  // 2. プロジェクトの集計キャッシュが実データと一致
  { name: 'project_amount_cache', sql: `
      SELECT p.id, p."currentAmount", COALESCE(SUM(pl."totalAmount"),0) AS actual
      FROM "Project" p
      LEFT JOIN "Pledge" pl ON pl."projectId" = p.id
        AND pl.status IN ('AUTHORIZED','CAPTURED')
      GROUP BY p.id, p."currentAmount"
      HAVING p."currentAmount" <> COALESCE(SUM(pl."totalAmount"),0)` },

  // 3. リターン在庫が実データと一致
  { name: 'reward_stock', sql: `
      SELECT r.id, r."quantityClaimed", COALESCE(SUM(pl.quantity),0) AS actual
      FROM "Reward" r
      LEFT JOIN "Pledge" pl ON pl."rewardId" = r.id
        AND pl.status IN ('PENDING','AUTHORIZED','CAPTURED')
      GROUP BY r.id, r."quantityClaimed"
      HAVING r."quantityClaimed" <> COALESCE(SUM(pl.quantity),0)` },

  // 4. 在庫上限を超えていない
  { name: 'reward_overbooked', sql: `
      SELECT id FROM "Reward"
      WHERE "quantityLimit" IS NOT NULL AND "quantityClaimed" > "quantityLimit"` },

  // 5. 出品者未払金がマイナスになっていない
  { name: 'negative_payable', sql: `
      SELECT "subjectId", SUM(amount) AS bal FROM "LedgerEntry"
      WHERE account = 'CREATOR_PAYABLE'
      GROUP BY "subjectId" HAVING SUM(amount) > 0` },
      // ※ 負債なので通常マイナス。プラス = 払いすぎ

  // 6. 金額の内訳が合っている
  { name: 'pledge_amount_consistency', sql: `
      SELECT id FROM "Pledge"
      WHERE "totalAmount" <> "rewardAmount" + "additionalTip"
         OR "creatorPayout" <> "totalAmount" - "platformFee" - "stripeFee"` },
]
```

### Stripe との突き合わせ

上の6つはアプリ内部の整合性。**外部との一致はこれとは別に確認する。**

```ts
// 前日分の balance_transaction を全件取得して台帳と照合
const txns = await stripe.balanceTransactions.list({
  created: { gte: startOfYesterday, lt: startOfToday },
  limit: 100,
})
// Stripe 側の net 合計 と PLATFORM_CASH の当日増減が一致するか
```

**ズレていたら「原因が分かるまでリリースを止める」。** ¥1 のズレでも放置しない。放置すると次のズレと混ざって原因が特定できなくなる。

### 通知

不一致を検知したら Slack か メールで即通知。**ダッシュボードに出すだけでは誰も見ない。**

---

## 5. 二重支払い・多重請求の防止（多層防御）

決済で一番怖い事故。**1つの対策に頼らず、4層で守る。**

| 層 | 対策 |
|---|---|
| UI | ボタンを押した瞬間に `disabled` + 「処理中…」 |
| Server Action | 同一ユーザー・同一リターンで `PENDING` の Pledge が既にあれば新規作成させない（またはそれを再利用） |
| Stripe API | `idempotency_key` を必ず指定（`pledge-capture-${pledgeId}`） |
| DB | `stripePaymentIntentId` / `stripeCheckoutSessionId` に unique 制約 |

```ts
// Server Action 層
const existing = await prisma.pledge.findFirst({
  where: { backerId, projectId, rewardId, status: 'PENDING',
           createdAt: { gt: new Date(Date.now() - 30 * 60_000) } },
})
if (existing?.stripeCheckoutSessionId) {
  // 既存の Checkout をやり直させる。新しい Pledge を作らない
  const s = await stripe.checkout.sessions.retrieve(existing.stripeCheckoutSessionId)
  if (s.status === 'open') return { ok: true, data: { url: s.url! } }
}
```

**冪等キーは「同じ意味の操作なら同じ値」になるように作る。** `Date.now()` や `randomUUID()` を混ぜたら意味がない。

---

## 6. 上限・レート制限・不正対策

### 金額の上限

無制限にすると、盗難カードのテスト（カードテスティング）とマネーロンダリングの標的になる。

```ts
export const LIMITS = {
  PLEDGE_MIN:              500,        // 1回の最低支援額
  PLEDGE_MAX:          1_000_000,      // 1回の上限
  USER_DAILY_MAX:      2_000_000,      // 1ユーザー1日の上限
  USER_DAILY_COUNT_MAX:      20,       // 1ユーザー1日の支援回数
  PROJECT_GOAL_MAX:   50_000_000,      // 目標金額の上限
  TIP_MAX_RATIO:              5,       // 上乗せはリターン額の5倍まで
}
```

超えたら**ブロックではなく審査待ちにする**運用もあり得るが、初期は単純にブロックでよい。

### レート制限

| 対象 | 制限 |
|---|---|
| ログインリンク送信 | 同一メール 5回/時 |
| Checkout 作成 | 同一ユーザー 10回/時、同一 IP 30回/時 |
| コメント投稿 | 同一ユーザー 20回/時 |
| 画像アップロード | 同一ユーザー 50回/日 |

Upstash Redis か、単純に DB のカウンタテーブルで十分。

### Stripe Radar

Stripe 側の不正検知を必ず有効にする。カスタムルール例:

- 同一 IP から 15分で 5件以上の決済試行 → ブロック
- カード発行国が日本以外 かつ 金額 > ¥50,000 → レビュー
- 3D セキュアを高額決済で必須化 → **チャージバック時の責任がカード会社に移る**（liability shift）

### 自己支援・関係者支援の禁止

```ts
if (project.creator.userId === session.user.id) {
  return { ok: false, error: '自身のプロジェクトは支援できません' }
}
```

手数料の還流やマネロンの温床になる。**サーバー側で必ず弾く。**

---

## 7. チャージバック（Dispute）対応

購入型クラファンは「商品が届くのが数ヶ月後」なので、**チャージバック率が高くなりやすい業種**。Stripe に高リスク扱いされる要因でもある。

### 予防

- [ ] **明細表記（statement descriptor）をサービス名にする。** 見覚えのない表記が一番の原因。`FUNDBEAT*PROJECT` のように分かりやすく
- [ ] 支援直後に確認メールを送る（何にいくら払ったか・いつ届くか）
- [ ] お届け予定を過ぎたら自動で状況通知
- [ ] 3D セキュアを適用する（liability shift が効く）
- [ ] 支援画面と規約でリターン提供時期を明示

### 発生時

```
charge.dispute.created を受信
  ├─ 運営に即時通知（Slack）
  ├─ Pledge に disputed フラグ
  ├─ ★ 該当プロジェクトの未送金分を保留（自動送金を止める）
  └─ 台帳に DISPUTE_OPEN を記帳
       PLATFORM_CASH −10,000 / DISPUTE_HOLD +10,000
```

**負けた場合、Stripe 手数料に加えてチャージバック手数料も取られ、しかも出品者には既に送金済み**というのが最悪ケース。だから「未送金分を保留する」処理を自動で入れる。

回収不能分は `DISPUTE_LOSS` に計上し、**規約で出品者への求償を定めておく**（実際に回収できるかは別問題だが、根拠がないと請求すらできない）。

---

## 8. 送金タイミングの設計（重要な運用判断）

Stripe の destination charge は**決済と同時に出品者へ資金を移す**のがデフォルト。しかしクラファンでは、これは危険。

### 問題

- All-in で募集初日に支援 → 即座に出品者へ送金 → 出品者が持ち逃げ、または募集途中でプロジェクトが規約違反で停止 → **返金原資がない**
- チャージバックが来たときに出品者残高が空

### 対策: 送金を遅延させる

```ts
// 決済時は送金せず、プラットフォーム残高に留める
payment_intent_data: {
  // transfer_data を指定しない
  // → 全額がプラットフォーム残高に入る
}

// 募集終了 + 一定期間経過後に、まとめて transfer する
await stripe.transfers.create({
  amount: totalPayout,
  currency: 'jpy',
  destination: creator.stripeAccountId,
  transfer_group: `project_${projectId}`,
  metadata: { projectId },
}, { idempotencyKey: `payout-${projectId}-${batchNo}` })
```

**推奨: 募集終了の7日後にまとめて送金。**

| 方式 | 資金リスク | 実装 | 出品者の資金繰り |
|---|---|---|---|
| 即時送金（destination charge） | 高 | 楽 | 良い |
| **募集終了+7日でまとめて送金（separate transfer）** | **低** | 中 | 普通 |
| 検収後送金 | 最低 | 重い | 悪い |

ただし**資金を長期間プラットフォームに滞留させると法務論点が出る**（[10-legal.md](10-legal.md)）。7日程度なら「返金・チャージバック対応のための合理的な期間」として説明がつく。**期間は規約に明記する。** ここは弁護士に確認する項目。

送金を分離すると、Connect の `payout` 回数も減るのでコスト面でも有利（[13-payment-cost.md](13-payment-cost.md)）。

---

## 9. 監査ログ

**お金と権限に関わる操作は全部記録する。** 「誰が」「いつ」「何を」「なぜ」。

```prisma
model AuditLog {
  id         String   @id @default(cuid())
  actorId    String?              // 操作者。システムなら null
  actorType  String               // "USER" | "ADMIN" | "SYSTEM" | "WEBHOOK"
  action     String               // "pledge.refund" | "project.suspend" ...
  targetType String
  targetId   String
  before     Json?
  after      Json?
  reason     String?  @db.Text    // 運営操作では必須
  ip         String?
  userAgent  String?
  createdAt  DateTime @default(now())

  @@index([targetType, targetId, createdAt])
  @@index([actorId, createdAt])
}
```

記録必須の操作:

- 返金・手動調整仕訳・送金の実行と停止
- プロジェクトの承認・却下・強制停止
- ロール変更（CREATOR / ADMIN 付与）
- 手数料率の変更
- 個人情報（配送先）のエクスポート
- 管理画面へのログイン

**返金と手動調整には理由の入力を必須にする。** UI で必須にし、サーバーでも検証する。

---

## 10. 運用の安全装置

### キルスイッチ

```prisma
model SystemFlag {
  key       String   @id      // "pledges.enabled" | "payouts.enabled" | ...
  value     Boolean
  reason    String?
  updatedBy String?
  updatedAt DateTime @updatedAt
}
```

事故に気づいたとき、**デプロイせずに支援受付を止められる**ことが決定的に重要。デプロイに5分かかる間に被害が広がる。

- `pledges.enabled = false` → 新規支援を止める（既存は継続）
- `payouts.enabled = false` → 送金バッチを止める
- `signups.enabled = false` → 新規登録を止める（攻撃時）

### 4-eyes（二人承認）

金額の大きい操作は1人で実行できないようにする。

- ¥100,000 超の返金
- 手動調整仕訳
- 手数料率の変更

初期は運営が自分たちだけなので**「実行前に必ず Slack に投稿してから」という運用ルール + 監査ログ**で代替してよい。仕組み化は取引が増えてから。

### 本番データへのアクセス

- [ ] 本番 DB への直接 SQL は原則禁止。管理画面から操作する
- [ ] やむを得ず直接触るときは、**必ず読み取り専用ユーザーで**
- [ ] Stripe の本番キーはローカルに置かない
- [ ] Stripe の制限付き API キー（Restricted key）を使い、必要な権限だけ付与する

---

## 11. テスト戦略（決済部分）

### 必ず書くテスト

```ts
// 1. 手数料計算 — プロパティテスト
test.prop([fc.integer({ min: 500, max: 1_000_000 })])('内訳の合計は総額に一致', (amount) => {
  const f = calcFees(amount, 1000)
  expect(f.platformFee + f.paymentFee + f.creatorPayout).toBe(amount)
  expect(f.creatorPayout).toBeGreaterThan(0)
})

// 2. 台帳 — 不均衡な仕訳は必ず失敗する
test('unbalanced journal throws', async () => {
  await expect(postJournal(tx, {
    type: 'PLEDGE_CAPTURE', externalRef: 'x', occurredAt: new Date(),
    entries: [{ account: 'PLATFORM_CASH', amount: 100 }],
  })).rejects.toThrow(/Unbalanced/)
})

// 3. 冪等性 — 同じ Webhook を10回投げても結果は1回分
test('duplicate webhook is idempotent', async () => {
  for (let i = 0; i < 10; i++) await handleStripeEvent(sameEvent)
  const p = await prisma.project.findUnique({ where: { id } })
  expect(p!.currentAmount).toBe(10_000)
  expect(await prisma.ledgerJournal.count({ where: { pledgeId } })).toBe(1)
})

// 4. 在庫 — 残り1個に同時10リクエストで、成功はちょうど1件
test('concurrent pledges never oversell', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => createPledgeCheckout({ rewardId, quantity: 1 }))
  )
  expect(results.filter(r => r.status === 'fulfilled').length).toBe(1)
})

// 5. 状態機械 — 禁止された遷移は例外
test('CAPTURED -> PENDING is illegal', async () => {
  await expect(transitionPledge(tx, id, ['CAPTURED'], 'PENDING')).rejects.toThrow(/Illegal/)
})
```

### 手数料計算は「実額の期待値表」でも固定する

```ts
test.each([
  [500,     50,   18,   432],
  [1_000,  100,   36,   864],
  [3_333,  333,  120, 2_880],   // 端数が出るケース
  [10_000, 1000,  360, 8_640],
  [99_999, 10000, 3600, 86_399],
])('calcFees(%i)', (total, platform, payment, payout) => {
  const f = calcFees(total, 1000)
  expect([f.platformFee, f.paymentFee, f.creatorPayout]).toEqual([platform, payment, payout])
})
```

**端数が出るケースを必ず含める。** 丸め方を変えたときにここで落ちる。

### Stripe のテストクロック

All-or-Nothing の締切処理は、**Stripe のテストクロック**を使えば時間を進めてテストできる。60日待つ必要はない。

---

## 12. 実装チェックリスト（[06-stripe.md](06-stripe.md) への追加分）

- [ ] `LedgerJournal` / `LedgerEntry` を実装し、すべての金銭移動を記帳している
- [ ] `postJournal` が合計0を実行時検証している
- [ ] `LedgerEntry` に UPDATE/DELETE 禁止トリガーがある
- [ ] 状態遷移が `transitionPledge` を必ず経由している
- [ ] 金額の加算が「遷移成功後」にのみ実行される
- [ ] Outbox パターンでメール送信を分離している
- [ ] Outbox に `dedupeKey` の unique 制約がある
- [ ] 補完ポーリング（`sync-stale-pledges`）がある
- [ ] 整合性チェックが毎日走り、不一致で通知が飛ぶ
- [ ] Stripe の balance_transaction と台帳を突き合わせている
- [ ] 二重支払い対策が4層すべて入っている
- [ ] 金額上限・レート制限が入っている
- [ ] Stripe Radar のルールを設定した
- [ ] statement descriptor をサービス名にした
- [ ] Dispute 発生時に自動で送金を保留する
- [ ] 送金を募集終了+7日に遅延させている
- [ ] 監査ログを記録し、返金には理由を必須にしている
- [ ] キルスイッチ（`SystemFlag`）が動作する
- [ ] 手数料計算のプロパティテスト + 期待値表テストがある
- [ ] 同時実行の在庫テストが通る
- [ ] 本番キーがローカル / Git に存在しない
