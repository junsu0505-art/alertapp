import type { TrendlineAlert, TrendlinePoint, TickEvent } from '../types.js'

/**
 * 직선 y = m*x + b 에서 주어진 time 의 가격 (외삽 가능).
 * p1.time === p2.time (수직선) edge case → NaN 반환.
 * 수평선 (p1.price === p2.price) 은 slope=0 이므로 항상 동일 가격 반환.
 */
export function priceAtTime(
  p1: TrendlinePoint,
  p2: TrendlinePoint,
  time: number
): number {
  const dt = p2.time - p1.time
  if (dt === 0) {
    // 수직선: 시간 축 동일 → 직선 undefined
    return NaN
  }
  const slope = (p2.price - p1.price) / dt
  return p1.price + slope * (time - p1.time)
}

type EvaluateReason =
  | 'cross_above'
  | 'cross_below'
  | 'no_change'
  | 'paused'
  | 'wrong_symbol'

interface EvaluateResult {
  triggered: boolean
  linePrice: number
  reason: EvaluateReason
}

/**
 * cross 판정. 이전 tick price 와 현재 tick price 의 상대 위치 비교.
 *
 * 조기 반환 우선순위:
 *   1. wrong_symbol  — alert.symbol !== currTick.symbol
 *   2. paused        — alert.status !== 'armed'
 *   3. no_change     — prevTick === null (첫 tick, prev 없음)
 *   4. no_change     — p1.time === p2.time (수직선 → linePrice NaN)
 *
 * cross 판정 (strict 부등):
 *   cross_above: prev < linePrice && curr >= linePrice
 *   cross_below: prev > linePrice && curr <= linePrice
 *   그 외: no_change
 *
 * boundary 규칙: prev 가 정확히 linePrice 에 있으면 cross 로 간주하지 않음.
 */
export function evaluateAlert(
  alert: TrendlineAlert,
  prevTick: TickEvent | null,
  currTick: TickEvent
): EvaluateResult {
  // 1. symbol 불일치
  if (alert.symbol !== currTick.symbol) {
    return { triggered: false, linePrice: NaN, reason: 'wrong_symbol' }
  }

  // 2. 발화 대기 상태가 아님 (paused / triggered 등)
  if (alert.status !== 'armed') {
    const linePrice = priceAtTime(alert.p1, alert.p2, currTick.ts)
    return { triggered: false, linePrice, reason: 'paused' }
  }

  // 3. 첫 tick — prev 없음
  if (prevTick === null) {
    const linePrice = priceAtTime(alert.p1, alert.p2, currTick.ts)
    return { triggered: false, linePrice, reason: 'no_change' }
  }

  // 4. 수직선 (p1.time === p2.time) — linePrice undefined
  const linePrice = priceAtTime(alert.p1, alert.p2, currTick.ts)
  if (isNaN(linePrice)) {
    return { triggered: false, linePrice: NaN, reason: 'no_change' }
  }

  const prev = prevTick.price
  const curr = currTick.price

  if (alert.direction === 'cross_above') {
    // strict: prev 가 line 아래에 있어야 cross (prev < line, curr >= line)
    if (prev < linePrice && curr >= linePrice) {
      return { triggered: true, linePrice, reason: 'cross_above' }
    }
  } else {
    // cross_below: strict: prev 가 line 위에 있어야 cross (prev > line, curr <= line)
    if (prev > linePrice && curr <= linePrice) {
      return { triggered: true, linePrice, reason: 'cross_below' }
    }
  }

  return { triggered: false, linePrice, reason: 'no_change' }
}
