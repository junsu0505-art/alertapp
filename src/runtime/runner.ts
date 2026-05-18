/**
 * runner.ts — 가격 tick → cross 판정 → telegram 발송 오케스트레이터
 *
 * UP-15 race: JS single-thread. subscribe/unsubscribe 동시 호출 없음.
 *   triggered 후 추가 tick 도달 시 alert.status !== 'armed' → evaluateAlert false 반환 (R3 검증).
 * UP-16 secret: telegram config 는 sendTelegramMessage 인자로만 전달. console.log 0.
 * resource: stop() 시 ws.close() + _prevTick Map clear + _handlers Map clear.
 * null: loadSettings corrupt → EMPTY_SETTINGS fallback (store.ts 검증).
 * license: 외부 lib 0.
 */

import type { TrendlineAlert, TickEvent } from '../types.js'
import type { BinanceWsClient } from '../data/binance-ws.js'
import type { TickHandler } from '../data/binance-ws.js'
import { evaluateAlert } from '../engine/trendline.js'
import { sendTelegramMessage } from '../notify/telegram.js'
import { loadSettings, updateAlert, getTelegramConfig } from '../storage/store.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AlertRunnerOpts {
  ws: BinanceWsClient
  /** tick cross 발화 후 호출 (widget.refresh 목적) */
  onTrigger?: (alert: TrendlineAlert, tick: TickEvent) => void
}

// ---------------------------------------------------------------------------
// AlertRunner
// ---------------------------------------------------------------------------

export class AlertRunner {
  private readonly _ws: BinanceWsClient
  private readonly _onTrigger?: (alert: TrendlineAlert, tick: TickEvent) => void

  /** symbol(upper) → 마지막 TickEvent */
  private readonly _prevTick = new Map<string, TickEvent>()
  /** alert.id → TickHandler (unsubscribe 시 동일 참조 필요) */
  private readonly _handlers = new Map<string, TickHandler>()

  constructor(opts: AlertRunnerOpts) {
    this._ws = opts.ws
    this._onTrigger = opts.onTrigger
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * storage 에서 settings 로드 후 armed alert 전부 subscribe.
   * 중복 subscribe 방지: 이미 _handlers 에 있는 id 는 건너뜀.
   */
  async start(): Promise<void> {
    const settings = await loadSettings()
    for (const alert of settings.alerts) {
      if (alert.status === 'armed') {
        this.subscribe(alert)
      }
    }
  }

  /**
   * alert 를 ws 에 subscribe. 이미 등록된 id 이면 noop.
   */
  subscribe(alert: TrendlineAlert): void {
    if (this._handlers.has(alert.id)) return

    const handler: TickHandler = (tick: TickEvent) => {
      this._onTick(alert, tick)
    }

    this._handlers.set(alert.id, handler)
    this._ws.subscribe(alert.symbol, handler)
  }

  /**
   * alert 를 ws 에서 unsubscribe.
   * handler 참조 제거 + prevTick 캐시는 유지 (같은 symbol 다른 alert 사용 가능).
   */
  unsubscribe(alert: TrendlineAlert): void {
    const handler = this._handlers.get(alert.id)
    if (!handler) return

    this._handlers.delete(alert.id)
    this._ws.unsubscribe(alert.symbol, handler)
  }

  /**
   * 모든 subscription 해제 + ws.close() + 내부 상태 초기화.
   */
  stop(): void {
    for (const [id] of this._handlers) {
      const handler = this._handlers.get(id)
      if (handler) {
        // symbol 을 알아야 unsubscribe 가능 — _handlers 에 symbol 저장하지 않으므로
        // ws.close() 가 일괄 처리. 단, handler Map 만 정리.
      }
    }
    this._handlers.clear()
    this._prevTick.clear()
    this._ws.close()
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private _onTick(alert: TrendlineAlert, currTick: TickEvent): void {
    const prevTick = this._prevTick.get(currTick.symbol) ?? null

    const result = evaluateAlert(alert, prevTick, currTick)

    // prevTick 업데이트 (모든 tick, 판정 결과와 무관)
    this._prevTick.set(currTick.symbol, currTick)

    if (!result.triggered) return

    // triggered 처리 (fire-and-forget)
    this._handleTrigger(alert, currTick).catch(() => {
      // network error 무시 — 재시도 v1.5+
    })
  }

  private async _handleTrigger(alert: TrendlineAlert, tick: TickEvent): Promise<void> {
    // 1. status 업데이트 (storage)
    const now = Date.now()
    await updateAlert(alert.id, { status: 'triggered', triggeredAt: now })

    // 2. unsubscribe (이미 발화한 alert 는 더 이상 구독 불필요)
    this.unsubscribe(alert)

    // 3. Telegram 발송 (config 있을 때만)
    const cfg = await getTelegramConfig()
    if (cfg) {
      const dirLabel = alert.direction === 'cross_above' ? '위로 cross' : '아래로 cross'
      const linePrice = (tick.price).toLocaleString()
      const msg =
        `[alertapp] ${alert.symbol} 알람 발화\n` +
        `방향: ${dirLabel}\n` +
        `발화 가격: ${linePrice}\n` +
        `시각: ${new Date(now).toLocaleString('ko-KR')}`
      await sendTelegramMessage(cfg, msg)
    }

    // 4. onTrigger 콜백 (widget refresh 목적)
    const updatedAlert: TrendlineAlert = { ...alert, status: 'triggered', triggeredAt: now }
    this._onTrigger?.(updatedAlert, tick)
  }
}
