import { describe, it, expect } from 'vitest'
import { priceAtTime, evaluateAlert } from '../src/engine/trendline.js'
import type { TrendlineAlert, TrendlinePoint, TickEvent } from '../src/types.js'

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

function makeAlert(overrides: Partial<TrendlineAlert> = {}): TrendlineAlert {
  const base: TrendlineAlert = {
    id: 'test-id',
    symbol: 'BTCUSDT',
    exchange: 'binance',
    tfLabel: '4H',
    p1: { time: 1000, price: 59000 },
    p2: { time: 2000, price: 61000 },
    direction: 'cross_above',
    status: 'armed',
    createdAt: 0,
    triggeredAt: null,
  }
  return { ...base, ...overrides }
}

function makeTick(symbol: string, price: number, ts: number): TickEvent {
  return { symbol, price, ts }
}

// ─── priceAtTime ────────────────────────────────────────────────────────────

describe('priceAtTime', () => {
  // Case 1: 수평선 (p1.price === p2.price) → 항상 동일 가격
  it('Case 1: 수평선은 임의 시간에 항상 동일 가격', () => {
    const p1: TrendlinePoint = { time: 1000, price: 60000 }
    const p2: TrendlinePoint = { time: 2000, price: 60000 }
    expect(priceAtTime(p1, p2, 500)).toBe(60000)
    expect(priceAtTime(p1, p2, 1500)).toBe(60000)
    expect(priceAtTime(p1, p2, 3000)).toBe(60000)
  })

  // Case 2: 우상향 (시간↑ 가격↑) — 중점 시간 가격 검증
  it('Case 2: 우상향 — 중점 시간에 중간 가격', () => {
    const p1: TrendlinePoint = { time: 1000, price: 59000 }
    const p2: TrendlinePoint = { time: 2000, price: 61000 }
    // slope = 2000/1000 = 2 per sec, midpoint time=1500 → 59000 + 2*500 = 60000
    expect(priceAtTime(p1, p2, 1500)).toBe(60000)
  })

  // Case 3: 우하향
  it('Case 3: 우하향 — 중점 시간에 중간 가격', () => {
    const p1: TrendlinePoint = { time: 1000, price: 61000 }
    const p2: TrendlinePoint = { time: 2000, price: 59000 }
    // slope = -2000/1000 = -2 per sec, midpoint time=1500 → 61000 + (-2)*500 = 60000
    expect(priceAtTime(p1, p2, 1500)).toBe(60000)
  })

  // Case 4: 외삽 (p2 미래 시점) — 직선 연장 검증
  it('Case 4: 미래 시점 외삽 — 직선 연장', () => {
    const p1: TrendlinePoint = { time: 1000, price: 59000 }
    const p2: TrendlinePoint = { time: 2000, price: 61000 }
    // slope = 2, time=3000 → 59000 + 2*(3000-1000) = 59000+4000 = 63000
    expect(priceAtTime(p1, p2, 3000)).toBe(63000)
  })

  // Case 5: p1.time === p2.time edge case → NaN
  it('Case 5: p1.time === p2.time (수직선) → NaN', () => {
    const p1: TrendlinePoint = { time: 1000, price: 59000 }
    const p2: TrendlinePoint = { time: 1000, price: 61000 }
    expect(priceAtTime(p1, p2, 1000)).toBeNaN()
    expect(priceAtTime(p1, p2, 1500)).toBeNaN()
  })
})

// ─── evaluateAlert ──────────────────────────────────────────────────────────

describe('evaluateAlert', () => {
  // 우상향 추세선: p1=(1000,59000), p2=(2000,61000) → slope=2/sec
  // time=1500 → linePrice=60000

  // Case 6: cross_above true (prev 59500 → curr 60500, line 60000 @ t=1500)
  it('Case 6: cross_above triggered — prev below, curr above line', () => {
    const alert = makeAlert({ direction: 'cross_above' })
    const prev = makeTick('BTCUSDT', 59500, 1400)
    const curr = makeTick('BTCUSDT', 60500, 1500)
    const result = evaluateAlert(alert, prev, curr)
    expect(result.triggered).toBe(true)
    expect(result.reason).toBe('cross_above')
    expect(result.linePrice).toBe(60000)
  })

  // Case 7: cross_above false (prev 60500 → curr 61000, 둘 다 line 위)
  it('Case 7: cross_above not triggered — both above line', () => {
    const alert = makeAlert({ direction: 'cross_above' })
    const prev = makeTick('BTCUSDT', 60500, 1400)
    const curr = makeTick('BTCUSDT', 61000, 1500)
    const result = evaluateAlert(alert, prev, curr)
    expect(result.triggered).toBe(false)
    expect(result.reason).toBe('no_change')
  })

  // Case 8: cross_below true (prev 60500 → curr 59500, line 60000 @ t=1500)
  it('Case 8: cross_below triggered — prev above, curr below line', () => {
    const alert = makeAlert({ direction: 'cross_below' })
    const prev = makeTick('BTCUSDT', 60500, 1400)
    const curr = makeTick('BTCUSDT', 59500, 1500)
    const result = evaluateAlert(alert, prev, curr)
    expect(result.triggered).toBe(true)
    expect(result.reason).toBe('cross_below')
    expect(result.linePrice).toBe(60000)
  })

  // Case 9: cross_below false (prev 59500 → curr 59000, 둘 다 line 아래)
  it('Case 9: cross_below not triggered — both below line', () => {
    const alert = makeAlert({ direction: 'cross_below' })
    const prev = makeTick('BTCUSDT', 59500, 1400)
    const curr = makeTick('BTCUSDT', 59000, 1500)
    const result = evaluateAlert(alert, prev, curr)
    expect(result.triggered).toBe(false)
    expect(result.reason).toBe('no_change')
  })

  // Case 10: alert.status === 'paused' → triggered false, reason 'paused'
  it('Case 10: status paused → triggered false, reason paused', () => {
    const alert = makeAlert({ status: 'paused' })
    const prev = makeTick('BTCUSDT', 59500, 1400)
    const curr = makeTick('BTCUSDT', 60500, 1500)
    const result = evaluateAlert(alert, prev, curr)
    expect(result.triggered).toBe(false)
    expect(result.reason).toBe('paused')
  })

  // Case 11: alert.status === 'triggered' → triggered false, reason 'paused' (재발화 차단)
  it('Case 11: status triggered → triggered false (재발화 차단)', () => {
    const alert = makeAlert({ status: 'triggered' })
    const prev = makeTick('BTCUSDT', 59500, 1400)
    const curr = makeTick('BTCUSDT', 60500, 1500)
    const result = evaluateAlert(alert, prev, curr)
    expect(result.triggered).toBe(false)
    expect(result.reason).toBe('paused')
  })

  // Case 12: prevTick === null (첫 tick) → triggered false, reason 'no_change'
  it('Case 12: prevTick null (첫 tick) → triggered false, no_change', () => {
    const alert = makeAlert()
    const curr = makeTick('BTCUSDT', 60500, 1500)
    const result = evaluateAlert(alert, null, curr)
    expect(result.triggered).toBe(false)
    expect(result.reason).toBe('no_change')
  })

  // Case 13: alert.symbol !== currTick.symbol → wrong_symbol
  it('Case 13: symbol mismatch → wrong_symbol', () => {
    const alert = makeAlert({ symbol: 'BTCUSDT' })
    const prev = makeTick('ETHUSDT', 2900, 1400)
    const curr = makeTick('ETHUSDT', 3100, 1500)
    const result = evaluateAlert(alert, prev, curr)
    expect(result.triggered).toBe(false)
    expect(result.reason).toBe('wrong_symbol')
  })

  // Case 14 (bonus): boundary — prev === linePrice → cross 아님 (strict 부등)
  it('Case 14: boundary — prev === linePrice → cross_above not triggered', () => {
    const alert = makeAlert({ direction: 'cross_above' })
    // linePrice @ t=1500 = 60000
    const prev = makeTick('BTCUSDT', 60000, 1400) // prev 정확히 line 위
    const curr = makeTick('BTCUSDT', 60500, 1500)
    const result = evaluateAlert(alert, prev, curr)
    // prev < linePrice 는 false (60000 < 60000 = false) → cross 아님
    expect(result.triggered).toBe(false)
    expect(result.reason).toBe('no_change')
  })
})
