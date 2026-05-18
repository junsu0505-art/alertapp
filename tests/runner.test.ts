/**
 * runner.test.ts — AlertRunner 단위 테스트
 *
 * BinanceWsClient, storage, telegram 전부 mock.
 * evaluateAlert 는 실제 engine/trendline.ts 사용 (pure function, no side-effect).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AlertRunner } from '../src/runtime/runner.js'
import type { TrendlineAlert, TickEvent, Settings } from '../src/types.js'
import type { BinanceWsClient } from '../src/data/binance-ws.js'

// ---------------------------------------------------------------------------
// Mock: storage/store.js
// ---------------------------------------------------------------------------

const mockSettings: Settings = { telegram: null, alerts: [] }

vi.mock('../src/storage/store.js', () => ({
  loadSettings: vi.fn(async () => ({ ...mockSettings, alerts: [...mockSettings.alerts] })),
  updateAlert: vi.fn(async () => undefined),
  getTelegramConfig: vi.fn(async () => null),
}))

import { loadSettings, updateAlert, getTelegramConfig } from '../src/storage/store.js'

// ---------------------------------------------------------------------------
// Mock: notify/telegram.js
// ---------------------------------------------------------------------------

vi.mock('../src/notify/telegram.js', () => ({
  sendTelegramMessage: vi.fn(async () => ({ ok: true })),
}))

import { sendTelegramMessage } from '../src/notify/telegram.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAlert(overrides: Partial<TrendlineAlert> = {}): TrendlineAlert {
  return {
    id: crypto.randomUUID(),
    symbol: 'BTCUSDT',
    exchange: 'binance',
    tfLabel: '4H',
    p1: { time: 1700000000, price: 30000 },
    p2: { time: 1700003600, price: 31000 },
    direction: 'cross_above',
    status: 'armed',
    createdAt: Date.now(),
    triggeredAt: null,
    ...overrides,
  }
}

function makeTick(price: number, ts = 1700010000): TickEvent {
  return { symbol: 'BTCUSDT', price, ts }
}

function makeMockWs(): BinanceWsClient {
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    close: vi.fn(),
    isConnected: false,
  } as unknown as BinanceWsClient
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AlertRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettings.alerts = []
    mockSettings.telegram = null
  })

  // ── Case 1: start() → loadSettings 호출 + armed alerts 만 subscribe ───────
  it('Case 1: start() — loadSettings 호출 + armed alert 만 subscribe', async () => {
    const armedAlert = makeAlert({ status: 'armed' })
    const pausedAlert = makeAlert({ status: 'paused' })
    const triggeredAlert = makeAlert({ status: 'triggered' })
    mockSettings.alerts = [armedAlert, pausedAlert, triggeredAlert]

    const ws = makeMockWs()
    const runner = new AlertRunner({ ws })
    await runner.start()

    expect(loadSettings).toHaveBeenCalledOnce()
    // armed 1개만 subscribe
    expect(ws.subscribe).toHaveBeenCalledTimes(1)
    expect(ws.subscribe).toHaveBeenCalledWith(armedAlert.symbol, expect.any(Function))

    runner.stop()
  })

  // ── Case 2: prev null → evaluateAlert no_change → trigger X ──────────────
  it('Case 2: 첫 tick (prevTick null) → trigger 발생하지 않음', async () => {
    const alert = makeAlert({ direction: 'cross_above' })
    const ws = makeMockWs()
    const onTrigger = vi.fn()
    const runner = new AlertRunner({ ws, onTrigger })

    runner.subscribe(alert)

    // subscribe 시 ws.subscribe 에 등록된 handler 꺼내기
    const handler = vi.mocked(ws.subscribe).mock.calls[0]?.[1]
    expect(handler).toBeDefined()

    // 첫 tick (prev 없음) — price 가 어떻게 움직여도 trigger 안 됨
    handler!(makeTick(99999))

    expect(onTrigger).not.toHaveBeenCalled()
    expect(updateAlert).not.toHaveBeenCalled()

    runner.stop()
  })

  // ── Case 3: cross_above → triggered + updateAlert + sendTelegramMessage ──
  it('Case 3: cross_above 발화 → updateAlert status=triggered + sendTelegramMessage 호출', async () => {
    const alert = makeAlert({
      direction: 'cross_above',
      p1: { time: 1700000000, price: 30000 },
      p2: { time: 1700003600, price: 30000 }, // 수평선 at 30000
    })
    // getTelegramConfig 는 beforeEach clearAllMocks 이후 새로 지정
    vi.mocked(getTelegramConfig).mockResolvedValue({ botToken: 'test-token', chatId: '999' })
    mockSettings.telegram = { botToken: 'test-token', chatId: '999' }

    const ws = makeMockWs()
    const onTrigger = vi.fn()
    const runner = new AlertRunner({ ws, onTrigger })
    runner.subscribe(alert)

    const handler = vi.mocked(ws.subscribe).mock.calls[0]?.[1]!

    // tick 1: price 29000 (선 아래) → prev 설정
    handler(makeTick(29000, 1700010000))
    // tick 2: price 31000 (선 위로 cross) → trigger 발화
    handler(makeTick(31000, 1700010001))

    // _handleTrigger 는 async → updateAlert, sendTelegramMessage, onTrigger 순 실행
    // sendTelegramMessage 까지 완료 대기
    await vi.waitUntil(() => vi.mocked(sendTelegramMessage).mock.calls.length > 0, { timeout: 1000 })

    expect(updateAlert).toHaveBeenCalledWith(alert.id, {
      status: 'triggered',
      triggeredAt: expect.any(Number),
    })
    expect(sendTelegramMessage).toHaveBeenCalledOnce()
    expect(onTrigger).toHaveBeenCalledOnce()

    runner.stop()
  })

  // ── Case 4: telegram config 없음 → sendTelegramMessage 호출 X ────────────
  it('Case 4: telegram config null → sendTelegramMessage 호출 X', async () => {
    const alert = makeAlert({
      direction: 'cross_above',
      p1: { time: 1700000000, price: 30000 },
      p2: { time: 1700003600, price: 30000 }, // 수평선 at 30000
    })
    vi.mocked(getTelegramConfig).mockResolvedValue(null)

    const ws = makeMockWs()
    const runner = new AlertRunner({ ws })
    runner.subscribe(alert)

    const handler = vi.mocked(ws.subscribe).mock.calls[0]?.[1]!

    handler(makeTick(29000))
    handler(makeTick(31000))

    await vi.waitUntil(() => vi.mocked(updateAlert).mock.calls.length > 0, { timeout: 500 })

    expect(updateAlert).toHaveBeenCalled()
    expect(sendTelegramMessage).not.toHaveBeenCalled()

    runner.stop()
  })

  // ── Case 5: unsubscribe → ws.unsubscribe 호출 ────────────────────────────
  it('Case 5: unsubscribe() → ws.unsubscribe 호출 + _handlers 에서 제거', () => {
    const alert = makeAlert()
    const ws = makeMockWs()
    const runner = new AlertRunner({ ws })

    runner.subscribe(alert)
    expect(ws.subscribe).toHaveBeenCalledTimes(1)

    runner.unsubscribe(alert)
    expect(ws.unsubscribe).toHaveBeenCalledTimes(1)
    expect(ws.unsubscribe).toHaveBeenCalledWith(alert.symbol, expect.any(Function))

    // 2회 unsubscribe 호출 시 noop (handler 이미 없음)
    runner.unsubscribe(alert)
    expect(ws.unsubscribe).toHaveBeenCalledTimes(1)

    runner.stop()
  })

  // ── Case 6: stop() → ws.close + 상태 초기화 ───────────────────────────────
  it('Case 6: stop() → ws.close 호출 + subscribe 이후 tick 무시', async () => {
    const alert = makeAlert({
      p1: { time: 1700000000, price: 30000 },
      p2: { time: 1700003600, price: 30000 },
    })
    const ws = makeMockWs()
    const onTrigger = vi.fn()
    const runner = new AlertRunner({ ws, onTrigger })
    runner.subscribe(alert)

    const handler = vi.mocked(ws.subscribe).mock.calls[0]?.[1]!

    // prev 설정
    handler(makeTick(29000))

    // stop
    runner.stop()
    expect(ws.close).toHaveBeenCalledOnce()

    // stop 이후 tick 은 handler 참조가 이미 _handlers 에서 제거됐으므로
    // ws.unsubscribe 미호출이어도 실제 WS 가 closed 상태. onTrigger 호출 X.
    // (실제 ws.close 이후 ws 는 tick 을 더 이상 dispatch 하지 않음 — BinanceWsClient R2 검증)
    expect(onTrigger).not.toHaveBeenCalled()
    expect(updateAlert).not.toHaveBeenCalled()
  })
})
