/**
 * binance-ws.test.ts — BinanceWsClient 단위 테스트
 *
 * Mock WebSocket 을 vi.stubGlobal 로 주입.
 * jsdom 환경에서 실행 (vitest.config 의 environment: 'jsdom').
 */

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { BinanceWsClient, createBinanceWsClient } from '../src/data/binance-ws.js'
import type { TickHandler } from '../src/data/binance-ws.js'

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

type WsEventName = 'open' | 'message' | 'close' | 'error'

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState: number = MockWebSocket.CONNECTING
  url: string
  sentMessages: string[] = []

  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null

  /** 마지막 생성 인스턴스 (테스트에서 직접 접근) */
  static lastInstance: MockWebSocket | null = null
  static instances: MockWebSocket[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.lastInstance = this
    MockWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sentMessages.push(data)
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED
  }

  /** 테스트 헬퍼: 연결 완료 시뮬레이션 */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  /** 테스트 헬퍼: 메시지 수신 시뮬레이션 */
  simulateMessage(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }))
  }

  /** 테스트 헬퍼: 연결 종료 시뮬레이션 */
  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }

  /** 테스트 헬퍼: 에러 시뮬레이션 */
  simulateError(): void {
    this.onerror?.(new Event('error'))
    this.simulateClose()
  }
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  MockWebSocket.lastInstance = null
  MockWebSocket.instances = []
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', MockWebSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSent(ws: MockWebSocket, idx = 0): Record<string, unknown> {
  return JSON.parse(ws.sentMessages[idx] ?? '{}') as Record<string, unknown>
}

function makeTradeMsg(symbol: string, price: string, timeMs: number): string {
  return JSON.stringify({
    stream: `${symbol.toLowerCase()}@trade`,
    data: { p: price, T: timeMs, e: 'trade', s: symbol.toUpperCase() },
  })
}

// ---------------------------------------------------------------------------
// Test Cases
// ---------------------------------------------------------------------------

describe('BinanceWsClient', () => {
  // Case 1: subscribe → WebSocket 생성 + SUBSCRIBE 메시지 전송
  it('Case 1: subscribe 호출 시 WebSocket 생성 + SUBSCRIBE 메시지 전송', () => {
    const client = createBinanceWsClient({ url: 'wss://mock.test' })
    const handler: TickHandler = vi.fn()

    client.subscribe('BTCUSDT', handler)
    const ws = MockWebSocket.lastInstance!
    expect(ws).toBeTruthy()
    expect(ws.url).toBe('wss://mock.test')

    ws.simulateOpen()

    expect(ws.sentMessages).toHaveLength(1)
    const msg = parseSent(ws)
    expect(msg['method']).toBe('SUBSCRIBE')
    expect(msg['params']).toEqual(['btcusdt@trade'])
    expect(typeof msg['id']).toBe('number')

    client.close()
  })

  // Case 2: trade 메시지 → handler 호출 + TickEvent 파싱 (price float / ts seconds)
  it('Case 2: trade 메시지 → handler 호출 + TickEvent 파싱 검증', () => {
    const client = createBinanceWsClient({ url: 'wss://mock.test' })
    const handler: TickHandler = vi.fn()

    client.subscribe('BTCUSDT', handler)
    const ws = MockWebSocket.lastInstance!
    ws.simulateOpen()

    ws.simulateMessage(makeTradeMsg('BTCUSDT', '62000.50', 1_716_000_000_000))

    expect(handler).toHaveBeenCalledTimes(1)
    const tick = (handler as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(tick?.symbol).toBe('BTCUSDT')
    expect(tick?.price).toBeCloseTo(62000.5, 2)
    expect(tick?.ts).toBe(1_716_000_000) // ms → seconds

    client.close()
  })

  // Case 3: 같은 symbol 두 번째 subscribe → 새 connection X, handler 만 추가
  it('Case 3: 같은 symbol 두 번째 subscribe → WebSocket 추가 생성 없음', () => {
    const client = createBinanceWsClient({ url: 'wss://mock.test' })
    const h1: TickHandler = vi.fn()
    const h2: TickHandler = vi.fn()

    client.subscribe('BTCUSDT', h1)
    const ws = MockWebSocket.lastInstance!
    ws.simulateOpen()

    const instanceCountBefore = MockWebSocket.instances.length

    client.subscribe('BTCUSDT', h2)

    // 추가 WebSocket 인스턴스 생성 없음
    expect(MockWebSocket.instances.length).toBe(instanceCountBefore)

    // 두 번째 subscribe 시 btcusdt@trade 는 이미 구독 중 → SUBSCRIBE 전송은 추가로 발생
    // (같은 symbol key 존재하므로 _sendSubscribe 가 호출되지 않음)
    // trade 메시지 → 두 handler 모두 호출
    ws.simulateMessage(makeTradeMsg('BTCUSDT', '63000.00', 1_716_000_001_000))

    expect(h1).toHaveBeenCalledTimes(1)
    expect(h2).toHaveBeenCalledTimes(1)

    client.close()
  })

  // Case 4: unsubscribe → handler 제거. 마지막 handler 제거 시 UNSUBSCRIBE 메시지 전송
  it('Case 4: unsubscribe → handler 제거, 마지막 제거 시 UNSUBSCRIBE 전송', () => {
    const client = createBinanceWsClient({ url: 'wss://mock.test' })
    const h1: TickHandler = vi.fn()
    const h2: TickHandler = vi.fn()

    client.subscribe('ETHUSDT', h1)
    client.subscribe('ETHUSDT', h2)
    const ws = MockWebSocket.lastInstance!
    ws.simulateOpen()

    const sentBefore = ws.sentMessages.length

    // h1 제거 — handler 1개 남음 → UNSUBSCRIBE X
    client.unsubscribe('ETHUSDT', h1)
    expect(ws.sentMessages.length).toBe(sentBefore)

    // h2 제거 — handler 0개 → UNSUBSCRIBE 전송
    client.unsubscribe('ETHUSDT', h2)
    expect(ws.sentMessages.length).toBe(sentBefore + 1)
    const msg = parseSent(ws, sentBefore)
    expect(msg['method']).toBe('UNSUBSCRIBE')
    expect(msg['params']).toEqual(['ethusdt@trade'])

    // 이후 trade 메시지 → 아무 handler 도 호출 안 됨
    ws.simulateMessage(makeTradeMsg('ETHUSDT', '3000.00', 1_716_000_002_000))
    expect(h1).not.toHaveBeenCalled()
    expect(h2).not.toHaveBeenCalled()

    client.close()
  })

  // Case 5: ws.close 이벤트 → reconnect 시도 + subscriptions 재구독
  it('Case 5: ws.close 이벤트 → reconnect 시도 + subscriptions 재구독', () => {
    const client = createBinanceWsClient({ url: 'wss://mock.test', maxBackoffMs: 30_000 })
    const handler: TickHandler = vi.fn()

    client.subscribe('BTCUSDT', handler)
    const ws1 = MockWebSocket.lastInstance!
    ws1.simulateOpen()

    // 서버 측 disconnect 시뮬레이션
    ws1.simulateClose()

    // backoff 1s 경과 → reconnect
    vi.advanceTimersByTime(1_000)

    const ws2 = MockWebSocket.lastInstance!
    expect(ws2).not.toBe(ws1) // 새 WebSocket 생성
    ws2.simulateOpen()

    // 재연결 후 SUBSCRIBE 재전송 확인
    const resubMsg = JSON.parse(ws2.sentMessages[0] ?? '{}') as Record<string, unknown>
    expect(resubMsg['method']).toBe('SUBSCRIBE')
    expect(resubMsg['params']).toEqual(['btcusdt@trade'])

    // 재연결된 connection 으로 tick 수신
    ws2.simulateMessage(makeTradeMsg('BTCUSDT', '64000.00', 1_716_000_003_000))
    expect(handler).toHaveBeenCalledTimes(1)

    client.close()
  })

  // Case 6: close() → 모든 timer clear, ws.close 호출
  it('Case 6: close() → reconnect timer clear, ws.close 호출', () => {
    const client = createBinanceWsClient({ url: 'wss://mock.test' })
    const handler: TickHandler = vi.fn()

    client.subscribe('BTCUSDT', handler)
    const ws = MockWebSocket.lastInstance!
    ws.simulateOpen()

    // close 이벤트 발동 → reconnect 예약
    ws.simulateClose()
    // 아직 timer 실행 전에 close() 호출
    client.close()

    // timer 실행돼도 reconnect X
    vi.advanceTimersByTime(5_000)

    // ws1 이후 새 인스턴스 없음
    expect(MockWebSocket.instances.length).toBe(1)
    // isConnected false
    expect(client.isConnected).toBe(false)
  })

  // Case 7 (bonus): 잘못된 JSON 메시지 → 무시, throw X
  it('Case 7: 잘못된 JSON 메시지 → throw 없이 무시', () => {
    const client = createBinanceWsClient({ url: 'wss://mock.test' })
    const handler: TickHandler = vi.fn()

    client.subscribe('BTCUSDT', handler)
    const ws = MockWebSocket.lastInstance!
    ws.simulateOpen()

    expect(() => {
      ws.simulateMessage('{ broken json :::')
    }).not.toThrow()

    expect(handler).not.toHaveBeenCalled()

    client.close()
  })

  // Case 8 (bonus): backoff 순서 검증 — 연속 실패 시 1s → 2s → 4s 지수 증가
  // (simulateOpen 을 호출하지 않으면 _reconnectAttempts 가 누적됨)
  it('Case 8: 연속 실패 시 backoff 1s → 2s → 4s 순서', () => {
    const client = createBinanceWsClient({ url: 'wss://mock.test', maxBackoffMs: 30_000 })
    const handler: TickHandler = vi.fn()

    client.subscribe('BTCUSDT', handler)
    let ws = MockWebSocket.lastInstance!
    // open 없이 바로 close → attempt=0, backoff=1s
    ws.simulateClose()

    expect(MockWebSocket.instances.length).toBe(1)
    vi.advanceTimersByTime(999)
    expect(MockWebSocket.instances.length).toBe(1) // 아직 X
    vi.advanceTimersByTime(1) // 1000ms 경과
    expect(MockWebSocket.instances.length).toBe(2) // reconnect ws2

    // ws2 도 open 없이 close → attempt=1, backoff=2s
    ws = MockWebSocket.lastInstance!
    ws.simulateClose()
    vi.advanceTimersByTime(1_999)
    expect(MockWebSocket.instances.length).toBe(2) // 아직 X
    vi.advanceTimersByTime(1) // 2000ms 경과
    expect(MockWebSocket.instances.length).toBe(3) // reconnect ws3

    // ws3 도 open 없이 close → attempt=2, backoff=4s
    ws = MockWebSocket.lastInstance!
    ws.simulateClose()
    vi.advanceTimersByTime(3_999)
    expect(MockWebSocket.instances.length).toBe(3) // 아직 X
    vi.advanceTimersByTime(1) // 4000ms 경과
    expect(MockWebSocket.instances.length).toBe(4) // reconnect ws4

    client.close()
  })
})
