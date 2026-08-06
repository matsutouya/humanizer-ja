# 中核コード（コピー元）

**後から入れると非常に高くつく部分**を、そのまま貼れる形で用意してある。
Phase 0〜5 で、この4ファイルを最初に置いてから他の実装を始める。

| ファイル | 置き場所 | 何を守るか |
|---|---|---|
| [fees.ts](fees.ts) | `lib/fees.ts` | 手数料計算を1箇所に閉じ込める。端数のズレを防ぐ |
| [limits.ts](limits.ts) | `lib/limits.ts` | 金額上限・レート制限の定数を1箇所に集める |
| [pledge-state.ts](pledge-state.ts) | `lib/pledge-state.ts` | 不正な状態遷移と二重計上を構造的に防ぐ |
| [ledger.ts](ledger.ts) | `lib/ledger.ts` | 複式簿記の台帳。お金のズレを検知可能にする |

## 使い方

1. Phase 0 で `prisma/schema.prisma` に [03-db-schema.md](../docs/03-db-schema.md) と
   [11-payment-hardening.md](../docs/11-payment-hardening.md) のモデルを入れる
2. 上の4ファイルを `lib/` に配置する
3. `fees.ts` のテストを先に書いて通す（[08-roadmap.md](../docs/08-roadmap.md) のテスト方針）
4. その後に Server Actions と Webhook を実装する

## なぜ先に置くのか

- **`fees.ts`** — 手数料計算が複数箇所に散ると、必ず不整合が出る。しかも金額のズレは
  発覚が遅く、発覚したときには過去分の修正が必要になる
- **`pledge-state.ts`** — 状態遷移のガードを後から入れると、既存の呼び出し箇所を
  全部洗い直すことになる。しかも1つ漏れると二重計上が起きる
- **`ledger.ts`** — **後から台帳を足しても、過去の取引を再構成できない。**
  これが4つの中で最も後付けが効かない

## 注意

- Prisma のモデル名・フィールド名は [03-db-schema.md](../docs/03-db-schema.md) に合わせてある。
  スキーマを変えたらここも直す
- `isUniqueViolation` などのユーティリティは、プロジェクト側の実装に合わせて調整すること
- **型は実際の `@prisma/client` から import する。** ここでは説明のため一部を手書きしている
