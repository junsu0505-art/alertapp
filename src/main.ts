/**
 * main.ts — alertapp entry point (Tampermonkey userscript)
 *
 * 역할:
 *   1. Tampermonkey 환경 검증 (GM_setValue / GM_getValue 존재 확인)
 *   2. TV chart hydrate 대기 (waitForTvChart)
 *   3. AlertRunner 초기화 + WidgetOpts 구성 + mountWidget
 *   4. symbol 변경 감지 → runner 재구성
 *   5. 페이지 unload 시 runner.stop() + widget.destroy()
 *
 * UP-15 race: JS single-thread. onAddAlert 는 직렬로 실행. OK.
 * UP-16 secret: botToken 은 onSetTelegramConfig 인자만. console.log 0.
 * resource: beforeunload 에서 cleanup 보장.
 * null: waitForTvChart reject → alert + return (폴링 실패 대비).
 * license: 외부 lib 0.
 */

import {
  loadSettings,
  addAlert,
  removeAlert,
  setTelegramConfig,
  getTelegramConfig,
} from './storage/store.js'
import { createBinanceWsClient } from './data/binance-ws.js'
import {
  waitForTvChart,
  readAllTrendlines,
  readCurrentSymbol,
  subscribeSymbolChange,
} from './tradingview/dom.js'
import { mountWidget } from './tradingview/widget.js'
import { AlertRunner } from './runtime/runner.js'
import type { TrendlineAlert } from './types.js'

// ---------------------------------------------------------------------------
// Tampermonkey 환경 검증
// ---------------------------------------------------------------------------

function assertTampermonkey(): boolean {
  return (
    typeof GM_setValue === 'function' &&
    typeof GM_getValue === 'function' &&
    typeof GM_xmlhttpRequest === 'function'
  )
}

// ---------------------------------------------------------------------------
// 앱 상태
// ---------------------------------------------------------------------------

let runner: AlertRunner | null = null
let widgetHandle: ReturnType<typeof mountWidget> | null = null
let unsubscribeSymbol: (() => void) | null = null

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------

function cleanup(): void {
  runner?.stop()
  widgetHandle?.destroy()
  unsubscribeSymbol?.()
  runner = null
  widgetHandle = null
  unsubscribeSymbol = null
}

// ---------------------------------------------------------------------------
// 진입점 — Tampermonkey @run-at document-end 후 DOM ready 보장
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.info('[alertapp] main() entry')

  if (!assertTampermonkey()) {
    console.warn('[alertapp] Tampermonkey GM API 미존재. 스크립트를 종료합니다.')
    return
  }
  console.info('[alertapp] assertTampermonkey OK')

  // TV chart hydrate 대기
  try {
    await waitForTvChart()
    console.info('[alertapp] waitForTvChart resolved')
  } catch (err) {
    console.warn('[alertapp] waitForTvChart rejected', err)
    alert('alertapp: TradingView 차트 로드를 기다리다 시간 초과됐습니다. 페이지를 새로고침해 주세요.')
    return
  }

  // WS + Runner 초기화
  const ws = createBinanceWsClient()
  runner = new AlertRunner({
    ws,
    onTrigger: (_alert, _tick) => {
      widgetHandle?.refresh().catch(console.warn)
    },
  })
  await runner.start()
  console.info('[alertapp] AlertRunner started')

  // Widget mount
  console.info('[alertapp] mountWidget call')
  widgetHandle = mountWidget({
    // ── onAddAlert ──────────────────────────────────────────────────────────
    async onAddAlert(): Promise<void> {
      // 현재 추세선 목록 읽기
      const trendlines = readAllTrendlines()
      if (trendlines.length === 0) {
        alert('먼저 추세선을 그려주세요.')
        return
      }

      // 가장 최근 추세선 (배열 마지막)
      const last = trendlines[trendlines.length - 1]!

      // symbol 확인
      const symInfo = readCurrentSymbol()
      if (!symInfo.binanceSymbol) {
        alert(
          'alertapp: Binance Spot 심볼을 인식하지 못했습니다.\n' +
          'BINANCE:BTCUSDT 형식의 차트에서 사용해주세요.',
        )
        return
      }

      // direction 결정 (CTO 결정 — v1 MVP confirm() 방식)
      const isAbove = window.confirm(
        '위로 cross 알람을 받으시겠어요?\n(확인 = 위로 cross, 취소 = 아래로 cross)',
      )
      const direction: TrendlineAlert['direction'] = isAbove ? 'cross_above' : 'cross_below'

      // TrendlineAlert 생성
      const newAlert: TrendlineAlert = {
        id: crypto.randomUUID(),
        symbol: symInfo.binanceSymbol,
        exchange: 'binance',
        tfLabel: '–',        // v1: TV timeframe API 미연동. v1.5+에서 보강
        p1: last.p1,
        p2: last.p2,
        direction,
        status: 'armed',
        createdAt: Date.now(),
        triggeredAt: null,
      }

      await addAlert(newAlert)
      runner?.subscribe(newAlert)
    },

    // ── onRemoveAlert ────────────────────────────────────────────────────────
    async onRemoveAlert(id: string): Promise<void> {
      // storage 에서 삭제 전에 runner 에서 unsubscribe
      const settings = await loadSettings()
      const target = settings.alerts.find((a) => a.id === id)
      if (target) {
        runner?.unsubscribe(target)
      }
      await removeAlert(id)
    },

    // ── onSetTelegramConfig ──────────────────────────────────────────────────
    async onSetTelegramConfig(botToken: string, chatId: string): Promise<void> {
      await setTelegramConfig({ botToken, chatId })
      // 토스트: TV 환경에서 alert 대신 console 로그 (모달 방해 최소화)
      console.info('alertapp: Telegram 설정이 저장됐습니다.')
    },

    // ── getAlerts ────────────────────────────────────────────────────────────
    async getAlerts(): Promise<TrendlineAlert[]> {
      const settings = await loadSettings()
      return settings.alerts
    },

    // ── getTelegramConfig ─────────────────────────────────────────────────────
    async getTelegramConfig() {
      return getTelegramConfig()
    },
  })
  console.info('[alertapp] mountWidget done', widgetHandle ? 'OK' : 'NULL')

  // symbol 변경 감지 → runner 재구성
  unsubscribeSymbol = subscribeSymbolChange((_sym) => {
    // symbol 변경 시 현재 runner 는 기존 symbol alert 를 계속 감시 (정상).
    // 새 symbol 의 armed alert 는 addAlert 시 subscribe 되므로 별도 처리 불필요.
    // widget refresh 로 UI 동기화.
    widgetHandle?.refresh().catch(console.warn)
  })
  console.info('[alertapp] subscribeSymbolChange wired')

  // beforeunload cleanup
  window.addEventListener('beforeunload', cleanup)
  console.info('[alertapp] main() complete')
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

main()
  .then(() => console.info('[alertapp] main() resolved'))
  .catch((err: unknown) => {
    console.error('[alertapp] main() 오류', err)
  })
