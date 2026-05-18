/**
 * dom.ts — TradingView DOM hook (R0 정찰 결과 기반)
 *
 * 진입점: window._exposed_chartWidgetCollection.activeChartWidget.value()
 * 후보 1: lineToolsAndGroupsDTO() — 권장 (신뢰도 상)
 * 후보 2: pane.dataSources().filter(LineTool*) — fallback
 * 후보 3: subscribable 이벤트 — subscribeSymbolChange 에 활용
 *
 * Tampermonkey context:
 *   // @grant none  → window === page world (unsafeWindow 불필요)
 *   // @run-at document-idle
 *
 * UP-15 race: 단일 userscript 컨텍스트, 순차 실행. polling 중 navigation 발생 시
 *             try-catch silent fail 처리.
 * UP-16 secret: 이 파일은 좌표/symbol 만 read. token 등 비밀 없음.
 */

import type { TrendlinePoint } from '../types.js'

// ---------------------------------------------------------------------------
// Tampermonkey sandbox vs page world bridge
// @grant GM_* 모드에서 sandbox window 와 page window 분리됨.
// TV 의 _exposed_chartWidgetCollection 은 page window 에만 존재.
// unsafeWindow = page window (Tampermonkey 표준).
// 테스트 환경(Node/jsdom)에서는 unsafeWindow 없음 → window fallback.
// ---------------------------------------------------------------------------
declare const unsafeWindow: Window
const pageWindow: Window = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window

// ---------------------------------------------------------------------------
// 내부 TV DTO 타입 (실측 구조 기반)
// ---------------------------------------------------------------------------

interface TvToolDTO {
  type: string
  // points: [{time: unixSec, price: number}, ...] 또는 [{index, value}, ...]
  points: Array<{ time?: number; price?: number; index?: number; value?: number }>
  properties?: unknown
}

interface TvPaneDTO {
  sources: Map<string, TvToolDTO>
}

interface TvChartWidget {
  lineToolsAndGroupsDTO?: () => Map<number, TvPaneDTO>
  model?: () => TvModel
}

interface TvModel {
  panes: () => TvPane[]
}

interface TvDataSource {
  constructor: { name: string }
  toolname?: string
  points?: (() => Array<{ time?: number; price?: number }>) | Array<{ time?: number; price?: number }>
  _points?: Array<{ time?: number; price?: number }>
  id?: string
}

interface TvPane {
  dataSources: () => TvDataSource[]
  dataSourcesCollectionChanged?: { subscribe: (owner: null, cb: () => void) => void }
  sourcePropertiesChanged?: { subscribe: (owner: null, cb: () => void) => void }
}

// ---------------------------------------------------------------------------
// 공개 인터페이스
// ---------------------------------------------------------------------------

/** R0 정찰 결과 기반 TvTrendline. TV sources Map 에서 추출. */
export interface TvTrendline {
  id: string          // TV 내부 source id
  p1: TrendlinePoint
  p2: TrendlinePoint
  symbol: string      // 현재 chart symbol (readCurrentSymbol().raw)
}

// v1: trend_line 만 지원. extended_line / arrow / ray 는 v1.5+
const SUPPORTED_TYPES = new Set(['LineToolTrendLine'])

// ---------------------------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------------------------

/** window._exposed_chartWidgetCollection?.activeChartWidget?.value() 반환. */
function getActiveWidget(): TvChartWidget | null {
  try {
    const col = (pageWindow as unknown as Record<string, unknown>)['_exposed_chartWidgetCollection'] as
      | { activeChartWidget?: { value?: () => TvChartWidget } }
      | undefined
    const widget = col?.activeChartWidget?.value?.()
    return widget ?? null
  } catch {
    return null
  }
}

/**
 * TV DTO point → TrendlinePoint 변환.
 * TV 는 {time: unixSec, price} 형식. milliseconds 이면 /1000.
 */
function toTrendlinePoint(raw: {
  time?: number
  price?: number
  index?: number
  value?: number
}): TrendlinePoint {
  let time = raw.time ?? 0
  // 13자리 이상(ms) → seconds 변환
  if (time > 1e12) time = Math.floor(time / 1000)
  const price = raw.price ?? raw.value ?? 0
  return { time, price }
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * TV chart widget 이 hydrate 될 때까지 polling 대기.
 * 조건: window._exposed_chartWidgetCollection?.activeChartWidget?.value() 존재
 *       + lineToolsAndGroupsDTO 함수 존재.
 * 최대 timeoutMs (기본 30000ms). 초과 시 reject.
 */
export function waitForTvChart(timeoutMs = 30_000): Promise<TvChartWidget> {
  return new Promise((resolve, reject) => {
    const POLL_INTERVAL = 250
    const deadline = Date.now() + timeoutMs

    const timer = setInterval(() => {
      try {
        const w = getActiveWidget()
        if (w && typeof w.lineToolsAndGroupsDTO === 'function') {
          clearInterval(timer)
          resolve(w)
          return
        }
      } catch {
        // 아직 로딩 중 — 계속 polling
      }

      if (Date.now() >= deadline) {
        clearInterval(timer)
        reject(new Error(`alertapp: waitForTvChart timed out after ${timeoutMs}ms`))
      }
    }, POLL_INTERVAL)
  })
}

/**
 * 후보 1: lineToolsAndGroupsDTO() 로 모든 trendline 읽기.
 * 실패 시 후보 2 (dataSources filter) 로 fallback.
 * trend_line 타입만 반환 (v1).
 */
export function readAllTrendlines(): TvTrendline[] {
  const symbol = readCurrentSymbol().raw

  // ── 후보 1 ──────────────────────────────────────────────────────────────
  try {
    const w = getActiveWidget()
    if (w && typeof w.lineToolsAndGroupsDTO === 'function') {
      const dto = w.lineToolsAndGroupsDTO()
      const out: TvTrendline[] = []

      dto.forEach((paneDto) => {
        paneDto.sources.forEach((toolDto, id) => {
          if (!SUPPORTED_TYPES.has(toolDto.type)) return
          const pts = toolDto.points
          if (!pts || pts.length < 2) return
          out.push({
            id,
            p1: toTrendlinePoint(pts[0]!),
            p2: toTrendlinePoint(pts[1]!),
            symbol,
          })
        })
      })

      return out
    }
  } catch (e) {
    console.warn('alertapp: lineToolsAndGroupsDTO 실패 — 후보 2 시도', e)
  }

  // ── 후보 2 fallback: pane.dataSources() ─────────────────────────────────
  try {
    const w = getActiveWidget()
    const model = w?.model?.()
    if (!model) return []

    const out: TvTrendline[] = []
    model.panes().forEach((pane) => {
      pane.dataSources().forEach((src) => {
        const ctor = src.constructor?.name ?? ''
        const toolname = src.toolname ?? ctor
        if (!SUPPORTED_TYPES.has(toolname)) return

        const rawPts =
          typeof src.points === 'function'
            ? (src.points as () => Array<{ time?: number; price?: number }>)()
            : (src.points ?? src._points ?? [])

        if (!rawPts || rawPts.length < 2) return

        out.push({
          id: src.id ?? `fb-${Math.random()}`,
          p1: toTrendlinePoint(rawPts[0]!),
          p2: toTrendlinePoint(rawPts[1]!),
          symbol,
        })
      })
    })

    return out
  } catch (e) {
    console.warn('alertapp: 후보 2 dataSources fallback 도 실패. TV API 변경 가능성.', e)
    return []
  }
}

/**
 * 단일 ID 로 trendline 읽기 (refresh 용도).
 * null = 해당 ID 사라짐 / TV API 미사용 상태.
 */
export function readTrendlineById(id: string): TvTrendline | null {
  try {
    const all = readAllTrendlines()
    return all.find((t) => t.id === id) ?? null
  } catch (e) {
    console.warn('alertapp: readTrendlineById 실패', e)
    return null
  }
}

/**
 * 현재 chart symbol 읽기.
 * raw: TV 원본 (예: "BINANCE:BTCUSDT")
 * binanceSymbol: Binance spot 정규화 (예: "BTCUSDT").
 *   PERP suffix (.P) 또는 Binance prefix 없으면 null.
 */
export function readCurrentSymbol(): { raw: string; binanceSymbol: string | null } {
  try {
    const col = (pageWindow as unknown as Record<string, unknown>)['_exposed_chartWidgetCollection'] as
      | {
          activeChartWidget?: {
            value?: () => {
              symbol?: () => string
              activeChartSymbolInfo?: () => { name?: string }
            }
          }
        }
      | undefined

    const w = col?.activeChartWidget?.value?.()
    // TV 내부 symbol() 또는 activeChartSymbolInfo().name 에서 읽기
    let raw: string | undefined
    if (typeof w?.symbol === 'function') {
      raw = w.symbol()
    } else if (typeof w?.activeChartSymbolInfo === 'function') {
      raw = w.activeChartSymbolInfo()?.name
    }

    if (!raw) return { raw: '', binanceSymbol: null }

    return { raw, binanceSymbol: normalizeBinanceSymbol(raw) }
  } catch (e) {
    console.warn('alertapp: readCurrentSymbol 실패', e)
    return { raw: '', binanceSymbol: null }
  }
}

/**
 * "BINANCE:BTCUSDT" → "BTCUSDT"
 * "BINANCE:BTCUSDT.P" (PERP) → null (v1 spot만)
 * Binance prefix 없는 symbol → null
 */
export function normalizeBinanceSymbol(raw: string): string | null {
  const match = /^BINANCE:([A-Z0-9]+)(\.P)?$/.exec(raw)
  if (!match) return null          // 다른 거래소 또는 형식 불일치
  if (match[2] === '.P') return null  // PERP → v1 제외
  return match[1]!
}

/**
 * chart symbol 변경 감지 (subscribable hook).
 * 후보 3 (dataSourcesCollectionChanged) 에서 힌트 얻어 symbol polling 방식 구현.
 * TV activeChartWidget WatchedValue subscribe 도 병행 시도.
 * unsubscribe 함수 반환 (UP-15 resource).
 */
export function subscribeSymbolChange(
  cb: (s: { raw: string; binanceSymbol: string | null }) => void,
): () => void {
  let last = readCurrentSymbol().raw
  let stopped = false

  // TV subscribe 시도 (후보 3 hint)
  const unsubs: Array<() => void> = []
  try {
    const w = getActiveWidget()
    const model = w?.model?.()
    if (model) {
      model.panes().forEach((pane) => {
        // dataSourcesCollectionChanged 에서 symbol 변경 감지 가능
        if (pane.dataSourcesCollectionChanged) {
          pane.dataSourcesCollectionChanged.subscribe(null, () => {
            const sym = readCurrentSymbol()
            if (sym.raw !== last) {
              last = sym.raw
              cb(sym)
            }
          })
        }
      })
    }
  } catch {
    // subscribe 실패 — polling fallback 으로 충분
  }

  // polling fallback (300ms)
  const timerId = setInterval(() => {
    if (stopped) return
    try {
      const sym = readCurrentSymbol()
      if (sym.raw !== last) {
        last = sym.raw
        cb(sym)
      }
    } catch {
      // silent fail
    }
  }, 300)

  return () => {
    stopped = true
    clearInterval(timerId)
    unsubs.forEach((u) => u())
  }
}
