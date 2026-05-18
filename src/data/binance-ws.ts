/**
 * binance-ws.ts — Binance Spot combined trade stream WebSocket client
 *
 * Tampermonkey 환경: native browser WebSocket 글로벌 사용 (GM_ 불필요).
 *
 * UP-15 race: subscriptions Map add/remove 는 JS single-thread 보장. OK.
 *   reconnect timer 와 close() race → _reconnectTimer null check 후 clearTimeout.
 * UP-16 secret: URL 만 포함, API key/token 없음. 0 secret.
 * resource: close() 시 timer clear + ws.close(). unsubscribe 마지막 handler → UNSUBSCRIBE 전송.
 * null: ws.send 전 readyState === OPEN 검증. ws null check 포함.
 * license: 외부 lib 0. NOTICE 의무 없음.
 */

import type { TickEvent } from '../types.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TickHandler = (tick: TickEvent) => void

export interface BinanceWsClientOptions {
  /** WebSocket endpoint (테스트 주입 용). default: wss://stream.binance.com:9443/stream */
  url?: string
  /** reconnect backoff 최대 (ms). default: 30_000 */
  maxBackoffMs?: number
}

// ---------------------------------------------------------------------------
// Internal Binance message shapes
// ---------------------------------------------------------------------------

interface BinanceTradeData {
  /** price as string */
  p: string
  /** trade time (ms) */
  T: number
  [key: string]: unknown
}

interface BinanceCombinedMessage {
  stream: string
  data: BinanceTradeData
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_URL = 'wss://stream.binance.com:9443/stream'
const BASE_BACKOFF_MS = 1_000
const DEFAULT_MAX_BACKOFF_MS = 30_000

// ---------------------------------------------------------------------------
// BinanceWsClient implementation
// ---------------------------------------------------------------------------

export class BinanceWsClient {
  private readonly _url: string
  private readonly _maxBackoffMs: number

  private _ws: WebSocket | null = null
  /** symbol(lower) → Set<TickHandler> */
  private readonly _subscriptions = new Map<string, Set<TickHandler>>()
  private _reconnectAttempts = 0
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _closed = false
  private _msgIdCounter = 1

  constructor(opts: BinanceWsClientOptions = {}) {
    this._url = opts.url ?? DEFAULT_URL
    this._maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  get isConnected(): boolean {
    return this._ws?.readyState === WebSocket.OPEN
  }

  /**
   * symbol (대소문자 무관) 에 대한 trade tick 을 subscribe.
   * 최초 symbol 이면 connection 후 SUBSCRIBE 전송.
   * 이미 연결된 connection 이 있으면 SUBSCRIBE 메시지만 추가.
   */
  subscribe(symbol: string, handler: TickHandler): void {
    const key = symbol.toLowerCase()

    if (!this._subscriptions.has(key)) {
      this._subscriptions.set(key, new Set())
    }
    this._subscriptions.get(key)!.add(handler)

    if (this._ws === null) {
      // 첫 subscribe → 연결 시작
      this._connect()
    } else if (this._ws.readyState === WebSocket.OPEN) {
      // 이미 연결됨 → 신규 symbol SUBSCRIBE 메시지
      this._sendSubscribe([key])
    }
    // CONNECTING 상태이면 onopen 핸들러에서 일괄 구독
  }

  /**
   * handler 를 제거. handler 생략 시 symbol 의 모든 handler 제거.
   * 마지막 handler 제거 시 UNSUBSCRIBE 전송.
   */
  unsubscribe(symbol: string, handler?: TickHandler): void {
    const key = symbol.toLowerCase()
    const handlers = this._subscriptions.get(key)
    if (!handlers) return

    if (handler !== undefined) {
      handlers.delete(handler)
    } else {
      handlers.clear()
    }

    if (handlers.size === 0) {
      this._subscriptions.delete(key)
      this._sendUnsubscribe([key])
    }
  }

  /**
   * 모든 reconnect timer clear 후 ws.close().
   * 이후 reconnect 발동하지 않음.
   */
  close(): void {
    this._closed = true
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
    if (this._ws !== null) {
      this._ws.onclose = null // reconnect 콜백 제거
      this._ws.onerror = null
      this._ws.close()
      this._ws = null
    }
  }

  // -------------------------------------------------------------------------
  // Internal: connection lifecycle
  // -------------------------------------------------------------------------

  private _connect(): void {
    if (this._closed) return

    // combined stream URL 은 streams= 없이 /stream 으로 연결 후 SUBSCRIBE 메시지 사용
    const ws = new WebSocket(this._url)
    this._ws = ws

    ws.onopen = () => {
      this._reconnectAttempts = 0
      const symbols = Array.from(this._subscriptions.keys())
      if (symbols.length > 0) {
        this._sendSubscribe(symbols)
      }
    }

    ws.onmessage = (ev: MessageEvent) => {
      this._handleMessage(ev.data as string)
    }

    ws.onerror = () => {
      // onerror 는 onclose 와 함께 발동됨. onclose 에서 재연결 처리.
    }

    ws.onclose = () => {
      if (this._closed) return
      this._ws = null
      this._scheduleReconnect()
    }
  }

  private _scheduleReconnect(): void {
    if (this._closed) return

    const backoffMs = Math.min(
      BASE_BACKOFF_MS * Math.pow(2, this._reconnectAttempts),
      this._maxBackoffMs,
    )
    this._reconnectAttempts++

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      if (!this._closed) {
        this._connect()
      }
    }, backoffMs)
  }

  // -------------------------------------------------------------------------
  // Internal: message handling
  // -------------------------------------------------------------------------

  private _handleMessage(raw: string): void {
    let msg: unknown
    try {
      msg = JSON.parse(raw)
    } catch {
      // 잘못된 JSON → 무시
      return
    }

    if (!isCombinedMessage(msg)) return

    const streamParts = msg.stream.split('@')
    const symbolKey = streamParts[0] // e.g. "btcusdt"
    if (!symbolKey) return

    const handlers = this._subscriptions.get(symbolKey)
    if (!handlers || handlers.size === 0) return

    const priceNum = parseFloat(msg.data.p)
    if (!isFinite(priceNum)) return

    const tick: TickEvent = {
      symbol: symbolKey.toUpperCase(),
      price: priceNum,
      ts: Math.floor(msg.data.T / 1000), // ms → seconds
    }

    for (const handler of handlers) {
      handler(tick)
    }
  }

  // -------------------------------------------------------------------------
  // Internal: send helpers
  // -------------------------------------------------------------------------

  private _sendSubscribe(symbols: string[]): void {
    this._sendJson({
      method: 'SUBSCRIBE',
      params: symbols.map((s) => `${s}@trade`),
      id: this._msgIdCounter++,
    })
  }

  private _sendUnsubscribe(symbols: string[]): void {
    this._sendJson({
      method: 'UNSUBSCRIBE',
      params: symbols.map((s) => `${s}@trade`),
      id: this._msgIdCounter++,
    })
  }

  private _sendJson(payload: unknown): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(payload))
    }
  }
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isCombinedMessage(v: unknown): v is BinanceCombinedMessage {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o['stream'] !== 'string') return false
  if (typeof o['data'] !== 'object' || o['data'] === null) return false
  const d = o['data'] as Record<string, unknown>
  if (typeof d['p'] !== 'string') return false
  if (typeof d['T'] !== 'number') return false
  return true
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBinanceWsClient(opts?: BinanceWsClientOptions): BinanceWsClient {
  return new BinanceWsClient(opts)
}
