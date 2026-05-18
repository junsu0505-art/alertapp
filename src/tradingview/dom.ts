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
  // v2: 실제 type/points 는 state 한 단계 안에 있음 (TV-DOM-recon-v2.md)
  state?: {
    type: string
    points: Array<{
      time_t?: number
      time?: number
      price?: number
      index?: number
      value?: number
    }>
    state?: {
      symbol?: string
      interval?: string
    }
  }
  // v1 legacy fallback (구버전 TV 호환)
  type?: string
  points?: Array<{ time_t?: number; time?: number; price?: number; index?: number; value?: number }>
  properties?: unknown
}

interface TvPaneDTO {
  // layoutKey: '0' | '1' | '2' (pane index 아님 — recon-v2 핵심 정정)
  sources: Map<string, TvToolDTO>
}

interface TvChartWidget {
  // Map key = layoutKey string ('0','1','2'), pane index 아님 (recon-v2 정정)
  lineToolsAndGroupsDTO?: () => Map<string, TvPaneDTO>
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

// 2-point 대각선 류 라인 도구 (가격 cross 의미 있는 타입).
// 수평선(LineToolHorzLine)은 단일 가격 — v1.5+ 별도 처리.
// 수직선(LineToolVertLine)은 cross 의미 없음 — 제외.
const SUPPORTED_TYPES = new Set([
  'LineToolTrendLine',
  'LineToolRay',
  'LineToolExtended',
  'LineToolArrow',
  'LineToolTrendAngle',
  'LineToolDisjointAngle',
  'LineToolParallelChannel',  // 채널 — 첫 2점 사용
  'LineToolPolyline',          // 폴리라인 — 첫 2점만 사용 (fallback)
])

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
 * v2: time_t (unix epoch seconds) 우선, legacy time fallback.
 * milliseconds(13자리 이상) 이면 /1000 변환.
 */
function toTrendlinePoint(raw: {
  time_t?: number
  time?: number
  price?: number
  index?: number
  value?: number
}): TrendlinePoint {
  // time_t 우선 (v2 실측 필드명), legacy time 은 fallback
  let time = raw.time_t ?? raw.time ?? 0
  // 13자리 이상(ms) → seconds 변환 (legacy 호환)
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
 * 후보 1 결과 없으면 후보 2 (dataSources filter) 로 fallback.
 * 마우스 drag 로 그린 line tool 은 lineToolsAndGroupsDTO 에 미등장,
 * dataSources 에 toolname='LineToolTrendLine' 으로 저장됨 (hotfix5 핵심).
 */
export function readAllTrendlines(): TvTrendline[] {
  const symbol = readCurrentSymbol().raw
  let candidate1Result: TvTrendline[] = []

  // ── 후보 1: lineToolsAndGroupsDTO() v2 path (state 안 type/points) ────────
  try {
    const w = getActiveWidget()
    if (w && typeof w.lineToolsAndGroupsDTO === 'function') {
      const dto = w.lineToolsAndGroupsDTO()

      // R0-redo 정찰: DTO key 는 layoutKey ('0','1','2'). pane index 아님.
      // 모든 entries walk 의무 — '0' 만 보면 항상 empty (v1 핵심 결함).
      dto.forEach((paneDto) => {
        paneDto.sources.forEach((toolDto, id) => {
          // v2: type/points 가 toolDto.state 안에 있음
          const state = toolDto.state ?? toolDto
          const type = state?.type ?? toolDto.type
          if (!type || !SUPPORTED_TYPES.has(type)) return

          const pts = state?.points ?? toolDto.points
          if (!pts || pts.length < 2) return

          // entry 본인의 symbol 이 있으면 우선 사용, 없으면 chart symbol fallback
          const entrySymbol = toolDto.state?.state?.symbol ?? symbol

          candidate1Result.push({
            id,
            p1: toTrendlinePoint(pts[0]!),
            p2: toTrendlinePoint(pts[1]!),
            symbol: entrySymbol,
          })
        })
      })

      // 진단 console (hotfix3 에 추가된 것 유지 + v2 path marker)
      console.info('[alertapp] readAllTrendlines v2 path: 발견 line type =', [...dto.values()].flatMap(p => [...p.sources.values()].map(s => (s as any)?.state?.type ?? s.type)))
    }
  } catch (e) {
    console.warn('[alertapp] lineToolsAndGroupsDTO 실패 — 후보 2 시도', e)
  }

  // 후보 1 결과가 있으면 즉시 반환 (hotfix5: 빈 배열이면 후보 2 로 진입)
  if (candidate1Result.length > 0) return candidate1Result

  // ── 후보 2 fallback: pane.dataSources() ─────────────────────────────────
  // 마우스 drag 로 그린 trendline 은 lineToolsAndGroupsDTO 에 미포함,
  // pane.dataSources() 에 toolname='LineToolTrendLine' 으로 저장됨.
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
            ? (src.points as () => Array<{ time_t?: number; time?: number; price?: number }>)()
            : ((src.points as Array<{ time_t?: number; time?: number; price?: number }> | undefined) ?? src._points ?? [])

        if (!rawPts || rawPts.length < 2) return

        out.push({
          id: src.id ?? `fb-${Math.random().toString(36).slice(2, 10)}`,
          p1: toTrendlinePoint(rawPts[0]!),
          p2: toTrendlinePoint(rawPts[1]!),
          symbol,
        })
      })
    })

    console.info('[alertapp] readAllTrendlines fallback dataSources: 발견 toolname =',
      model.panes().flatMap(p => p.dataSources()).map(s => s.toolname ?? s.constructor?.name).filter(n => n && SUPPORTED_TYPES.has(n as string)))

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
 *
 * hotfix7: R0 evidence (21_real_widget.json) 기반 multi-fallback chain.
 * 존재하지 않는 symbol()/activeChartSymbolInfo() 제거,
 * getSymbol() → symbolWV → symbolInfoWV → mainSeries → symbol() 순으로 시도.
 */
export function readCurrentSymbol(): { raw: string; binanceSymbol: string | null } {
  try {
    const col = (pageWindow as unknown as Record<string, unknown>)['_exposed_chartWidgetCollection'] as
      | {
          activeChartWidget?: {
            value?: () => Record<string, unknown>
          }
        }
      | undefined

    const w = col?.activeChartWidget?.value?.()
    if (!w) return { raw: '', binanceSymbol: null }

    let raw: string | undefined
    const wAny = w as any

    // 1순위: getSymbol() — R0 evidence 확인된 TV 표준 method.
    // string 또는 SymbolInfo object 반환 가능.
    if (typeof wAny.getSymbol === 'function') {
      const s = wAny.getSymbol()
      raw = typeof s === 'string' ? s : (s?.name ?? s?.symbol ?? s?.ticker)
    }

    // 2순위: symbolWV().value() — watch value subscribable
    if (!raw && typeof wAny.symbolWV === 'function') {
      try {
        const s = wAny.symbolWV()?.value?.()
        raw = typeof s === 'string' ? s : (s?.name ?? s?.symbol ?? s?.ticker)
      } catch { /* silent */ }
    }

    // 3순위: symbolInfoWV().value().name
    if (!raw && typeof wAny.symbolInfoWV === 'function') {
      try {
        const info = wAny.symbolInfoWV()?.value?.()
        raw = info?.name ?? info?.symbol ?? info?.ticker
      } catch { /* silent */ }
    }

    // 4순위: model().mainSeries() 경유
    if (!raw && typeof wAny.model === 'function') {
      try {
        const ms = wAny.model()?.mainSeries?.()
        const ms2 = ms as any
        if (typeof ms2?.symbol === 'function') raw = ms2.symbol()
        else if (typeof ms2?.symbolInfo === 'function') raw = ms2.symbolInfo()?.name
      } catch { /* silent */ }
    }

    // 5순위 legacy: w.symbol() (구버전 TV 호환, 현재 미존재 — 보험 fallback)
    if (!raw && typeof wAny.symbol === 'function') {
      try { raw = wAny.symbol() } catch { /* silent */ }
    }

    // 진단 console (hotfix7 한정)
    console.info('[alertapp] readCurrentSymbol: raw =', raw)

    if (!raw) return { raw: '', binanceSymbol: null }
    return { raw, binanceSymbol: normalizeBinanceSymbol(raw) }
  } catch (e) {
    console.warn('[alertapp] readCurrentSymbol 실패', e)
    return { raw: '', binanceSymbol: null }
  }
}

/**
 * "BINANCE:BTCUSDT" → "BTCUSDT"
 * "BINANCE:BTC/USDT" → "BTCUSDT" (TV display 형식 slash 허용)
 * "BINANCE:BTCUSDT.P" or "BINANCE:BTC/USDT.P" (PERP) → null (v1 spot만)
 * "BINANCE:BTCUSDTPERP" → null (PERP 변형)
 * Binance prefix 없는 symbol → null
 */
export function normalizeBinanceSymbol(raw: string): string | null {
  // BINANCE: prefix + base symbol + optional /quote + optional .P suffix
  const match = /^BINANCE:([A-Z0-9]+)(?:\/([A-Z0-9]+))?(\.P)?$/.exec(raw)
  if (!match) return null          // 다른 거래소 또는 형식 불일치
  if (match[3]) return null        // .P suffix → PERP, v1 제외
  const symbol = match[2] ? `${match[1]}${match[2]}` : match[1]!
  if (symbol.endsWith('PERP')) return null  // BTCUSDTPERP 등 PERP 변형 제외
  return symbol
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
