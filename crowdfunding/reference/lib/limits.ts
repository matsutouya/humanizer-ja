/**
 * 上限・制限の定数。
 *
 * 上限がないと、抜け道が見つかったときに被害が青天井になる。
 * カードテスティング・資金洗浄・ポイントの荒稼ぎは、すべて「上限がない」ことで成立する。
 *
 * 詳細: docs/11-payment-hardening.md §6, docs/12-points-gamification.md §6
 */

/** 金額の上限（円）。決定事項シート B-5〜B-7 に対応 */
export const AMOUNT_LIMITS = {
  /** 1回の最低支援額 */
  PLEDGE_MIN: 500,
  /** 1回の支援上限 */
  PLEDGE_MAX: 1_000_000,
  /** 1ユーザー・1日の支援合計 */
  USER_DAILY_TOTAL_MAX: 2_000_000,
  /** 1ユーザー・1日の支援件数 */
  USER_DAILY_COUNT_MAX: 20,
  /** 目標金額の上限 */
  PROJECT_GOAL_MAX: 50_000_000,
  /** 目標金額の下限 */
  PROJECT_GOAL_MIN: 10_000,
  /** 上乗せ支援はリターン価格の何倍まで許すか */
  TIP_MAX_RATIO: 5,
} as const

/** プロジェクトの制約 */
export const PROJECT_LIMITS = {
  /** 募集期間の上限（日）。決定事項シート C-3 */
  DURATION_DAYS_MAX: 60,
  /** 募集期間の下限（日） */
  DURATION_DAYS_MIN: 7,
  /** リターンの最大数 */
  REWARDS_MAX: 20,
  /** リターンの最小数（1つもないと公開できない） */
  REWARDS_MIN: 1,
  /** キャッチコピーの文字数 */
  TAGLINE_MAX: 120,
  /** 本文の文字数 */
  DESCRIPTION_MAX: 50_000,
  /** 本文中の画像枚数 */
  IMAGES_MAX: 30,
} as const

/** アップロードの制約 */
export const UPLOAD_LIMITS = {
  IMAGE_BYTES_MAX: 5 * 1024 * 1024, // 5MB
  IMAGE_MIME_ALLOWED: ['image/jpeg', 'image/png', 'image/webp'] as const,
  /** カバー画像の推奨サイズ（UI に表示する） */
  COVER_RECOMMENDED: { width: 1200, height: 675 },
} as const

/**
 * レート制限。{ 回数, 期間(秒) }
 * Upstash Redis か、DB のカウンタテーブルで実装する。
 */
export const RATE_LIMITS = {
  /** ログインリンクの送信（同一メールアドレス） */
  AUTH_EMAIL: { limit: 5, windowSec: 3600 },
  /** Checkout セッションの作成（同一ユーザー） */
  CHECKOUT_CREATE_USER: { limit: 10, windowSec: 3600 },
  /** Checkout セッションの作成（同一 IP） */
  CHECKOUT_CREATE_IP: { limit: 30, windowSec: 3600 },
  /** コメント投稿 */
  COMMENT: { limit: 20, windowSec: 3600 },
  /** 画像アップロード */
  UPLOAD: { limit: 50, windowSec: 86_400 },
  /** 通報 */
  REPORT: { limit: 10, windowSec: 86_400 },
} as const

/** ポイントの上限。詳細: docs/12-points-gamification.md §4 */
export const POINT_LIMITS = {
  /** 1ユーザー・1日の獲得上限 */
  DAILY_EARN_MAX: 5_000,
  /** 紹介経由の獲得・1日上限 */
  REFERRAL_DAILY_MAX: 3_000,
  /** 紹介クリックによる獲得・1日上限 */
  REFERRAL_CLICK_DAILY_MAX: 50,
  /** シェア申告による獲得・1日上限 */
  SHARE_DECLARE_DAILY_MAX: 100,
  /** 紹介ポイントの保留期間（日）。返金・チャージバックを待つ */
  REFERRAL_HOLD_DAYS: 7,
  /** 登録直後は紹介ポイントの対象外にする期間（日） */
  NEW_ACCOUNT_INELIGIBLE_DAYS: 7,
  /** 有効期限（年）。決定事項シート D-5 */
  EXPIRY_YEARS: 2,
} as const

/** タイミングの設定 */
export const TIMING = {
  /** Checkout セッションの有効期限（分）。在庫を確保しておく時間 */
  CHECKOUT_EXPIRY_MIN: 30,
  /** 募集終了から出品者への送金までの日数。決定事項シート B-8 */
  PAYOUT_DELAY_DAYS: 7,
  /** 締切時決済の失敗をリトライする回数 */
  CAPTURE_RETRY_MAX: 3,
  /** リトライの間隔（日） */
  CAPTURE_RETRY_INTERVAL_DAYS: 3,
  /** 紹介元 Cookie の保持期間（日） */
  REFERRAL_COOKIE_DAYS: 30,
} as const

/**
 * 3D セキュアを必須にする金額のしきい値（円）。
 * 全件に適用すると決済成功率が落ちる。高額だけ守る。
 * 詳細: docs/13-payment-cost.md §3
 */
export const THREE_DS_THRESHOLD = 30_000

export class LimitExceededError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

/** 支援額のバリデーション。Server Action の入口で必ず通す */
export function assertPledgeAmount(input: {
  totalAmount: number
  rewardAmount: number
  additionalTip: number
}): void {
  const { totalAmount, rewardAmount, additionalTip } = input

  if (totalAmount < AMOUNT_LIMITS.PLEDGE_MIN) {
    throw new LimitExceededError(
      `支援金額は ${AMOUNT_LIMITS.PLEDGE_MIN} 円以上である必要があります`,
      'PLEDGE_MIN',
    )
  }
  if (totalAmount > AMOUNT_LIMITS.PLEDGE_MAX) {
    throw new LimitExceededError(
      `1回の支援金額の上限は ${AMOUNT_LIMITS.PLEDGE_MAX.toLocaleString('ja-JP')} 円です`,
      'PLEDGE_MAX',
    )
  }
  if (additionalTip > rewardAmount * AMOUNT_LIMITS.TIP_MAX_RATIO) {
    throw new LimitExceededError('上乗せ支援の金額が大きすぎます', 'TIP_MAX')
  }
}
