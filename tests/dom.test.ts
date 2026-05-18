/**
 * dom.test.ts — TradingView DOM hook 단위 테스트
 *
 * jsdom 환경: window._exposed_chartWidgetCollection 을 mock 으로 주입.
 * vitest globals = true (import 불필요).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  readAllTrendlines,
  readCurrentSymbol,
  normalizeBinanceSymbol,
  waitForTvChart,
  readTrendlineById,
  subscribeSymbolChange,
} from '../src/tradingview/dom.js'

// ---------------------------------------------------------------------------
// mock helpers
// ---------------------------------------------------------------------------

type MockWindow = Window & {
  _exposed_chartWidgetCollection?: {
    activeChartWidget?: {
      value?: () => MockChartWidget
    }
  }
}

interface MockChartWidget {
  lineToolsAndGroupsDTO?: () => Map<number, MockPaneDTO>
  symbol?: () => string
  model?: () => MockModel
}

interface MockPaneDTO {
  sources: Map<string, MockToolDTO>
}

interface MockToolDTO {
  type: string
  points: Array<{ time?: number; price?: number }>
}

interface MockPane {
  dataSources: () => MockDataSource[]
}

interface MockDataSource {
  constructor: { name: string }
  toolname?: string
  points?: Array<{ time?: number; price?: number }>
  id?: string
}

interface MockModel {
  panes: () => MockPane[]
}

function setMockWidget(widget: MockChartWidget | null): void {
  if (widget === null) {
    delete (window as MockWindow)._exposed_chartWidgetCollection
    return
  }
  ;(window as MockWindow)._exposed_chartWidgetCollection = {
    activeChartWidget: {
      value: () => widget,
    },
  }
}

function makePaneDTO(tools: Array<{ id: string; type: string; points: Array<{ time: number; price: number }> }>): MockPaneDTO {
  const sources = new Map<string, MockToolDTO>()
  tools.forEach((t) => sources.set(t.id, { type: t.type, points: t.points }))
  return { sources }
}

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  setMockWidget(null)
})

// ---------------------------------------------------------------------------
// Case 1: readAllTrendlines — 후보 1 정상 경로
// ---------------------------------------------------------------------------

describe('readAllTrendlines (후보 1 — lineToolsAndGroupsDTO)', () => {
  it('Case 1: TrendLine 2개 → 2개 반환, 좌표 변환 정확', () => {
    const dto = new Map<number, MockPaneDTO>()
    dto.set(0, makePaneDTO([
      {
        id: 'tl-1',
        type: 'LineToolTrendLine',
        points: [{ time: 1700000000, price: 30000 }, { time: 1700003600, price: 31000 }],
      },
      {
        id: 'tl-2',
        type: 'LineToolTrendLine',
        points: [{ time: 1700010000, price: 29000 }, { time: 1700020000, price: 28000 }],
      },
    ]))

    setMockWidget({
      lineToolsAndGroupsDTO: () => dto,
      symbol: () => 'BINANCE:BTCUSDT',
    })

    const result = readAllTrendlines()
    expect(result).toHaveLength(2)
    expect(result[0]!.id).toBe('tl-1')
    expect(result[0]!.p1).toEqual({ time: 1700000000, price: 30000 })
    expect(result[0]!.p2).toEqual({ time: 1700003600, price: 31000 })
    expect(result[1]!.p2.price).toBe(28000)
  })

  it('Case 2: type 필터 — LineToolHorzLine 은 v1 제외', () => {
    const dto = new Map<number, MockPaneDTO>()
    dto.set(0, makePaneDTO([
      {
        id: 'tl-horz',
        type: 'LineToolHorzLine',
        points: [{ time: 1700000000, price: 50000 }, { time: 1700003600, price: 50000 }],
      },
      {
        id: 'tl-trend',
        type: 'LineToolTrendLine',
        points: [{ time: 1700000000, price: 30000 }, { time: 1700003600, price: 31000 }],
      },
    ]))

    setMockWidget({
      lineToolsAndGroupsDTO: () => dto,
      symbol: () => 'BINANCE:BTCUSDT',
    })

    const result = readAllTrendlines()
    // HorzLine 제외, TrendLine 만
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('tl-trend')
  })

  it('Case 3: milliseconds time → /1000 변환', () => {
    const dto = new Map<number, MockPaneDTO>()
    dto.set(0, makePaneDTO([
      {
        id: 'tl-ms',
        type: 'LineToolTrendLine',
        points: [
          { time: 1700000000000, price: 30000 },  // ms
          { time: 1700003600000, price: 31000 },  // ms
        ],
      },
    ]))

    setMockWidget({
      lineToolsAndGroupsDTO: () => dto,
      symbol: () => 'BINANCE:BTCUSDT',
    })

    const result = readAllTrendlines()
    expect(result[0]!.p1.time).toBe(1700000000)
    expect(result[0]!.p2.time).toBe(1700003600)
  })

  it('Case 4: TV API 없음 → 빈 배열 반환 (silent fail)', () => {
    setMockWidget(null)
    expect(() => readAllTrendlines()).not.toThrow()
    const result = readAllTrendlines()
    expect(result).toEqual([])
  })

  it('Case 5: lineToolsAndGroupsDTO 없고 model fallback → 후보 2 경로', () => {
    // lineToolsAndGroupsDTO 없음 → 후보 2 시도
    // model() 도 없으므로 빈 배열
    setMockWidget({
      symbol: () => 'BINANCE:BTCUSDT',
      // lineToolsAndGroupsDTO 미제공
    })
    const result = readAllTrendlines()
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Case 6~8: readCurrentSymbol + normalizeBinanceSymbol
// ---------------------------------------------------------------------------

describe('readCurrentSymbol 정규화', () => {
  // hotfix7: getSymbol() 가 1순위 fallback
  it('Case 6: getSymbol() present → raw/binanceSymbol 정상 반환', () => {
    ;(window as any)._exposed_chartWidgetCollection = {
      activeChartWidget: { value: () => ({ getSymbol: () => 'BINANCE:BTCUSDT' }) },
    }
    const r = readCurrentSymbol()
    expect(r.raw).toBe('BINANCE:BTCUSDT')
    expect(r.binanceSymbol).toBe('BTCUSDT')
  })

  it('Case 6a: getSymbol() 없고 legacy symbol() present → fallback 동작', () => {
    setMockWidget({ symbol: () => 'BINANCE:BTCUSDT' })
    const r = readCurrentSymbol()
    expect(r.raw).toBe('BINANCE:BTCUSDT')
    expect(r.binanceSymbol).toBe('BTCUSDT')
  })

  it('Case 6b: symbolWV() fallback — getSymbol 없을 때', () => {
    ;(window as any)._exposed_chartWidgetCollection = {
      activeChartWidget: {
        value: () => ({
          symbolWV: () => ({ value: () => 'BINANCE:ETHUSDT' }),
        }),
      },
    }
    const r = readCurrentSymbol()
    expect(r.raw).toBe('BINANCE:ETHUSDT')
    expect(r.binanceSymbol).toBe('ETHUSDT')
  })

  it('Case 6c: symbolInfoWV() fallback — getSymbol/symbolWV 없을 때', () => {
    ;(window as any)._exposed_chartWidgetCollection = {
      activeChartWidget: {
        value: () => ({
          symbolInfoWV: () => ({ value: () => ({ name: 'BINANCE:SOLUSDT' }) }),
        }),
      },
    }
    const r = readCurrentSymbol()
    expect(r.raw).toBe('BINANCE:SOLUSDT')
    expect(r.binanceSymbol).toBe('SOLUSDT')
  })

  it('Case 7: BINANCE:BTCUSDT.P (PERP) → binanceSymbol null', () => {
    expect(normalizeBinanceSymbol('BINANCE:BTCUSDT.P')).toBeNull()
  })

  it('Case 8: COINBASE:BTCUSD (비Binance) → binanceSymbol null', () => {
    expect(normalizeBinanceSymbol('COINBASE:BTCUSD')).toBeNull()
  })

  // hotfix6 — TV display slash 형식
  it('Case 8a: BINANCE:BTC/USDT → BTCUSDT (TV display)', () => {
    expect(normalizeBinanceSymbol('BINANCE:BTC/USDT')).toBe('BTCUSDT')
  })

  it('Case 8b: BINANCE:ETH/USDT → ETHUSDT', () => {
    expect(normalizeBinanceSymbol('BINANCE:ETH/USDT')).toBe('ETHUSDT')
  })

  it('Case 8c: BINANCE:LRDC/USDT → LRDCUSDT (Tom 실측 case)', () => {
    expect(normalizeBinanceSymbol('BINANCE:LRDC/USDT')).toBe('LRDCUSDT')
  })

  it('Case 8d: BINANCE:BTC/USDT.P → null (PERP with slash)', () => {
    expect(normalizeBinanceSymbol('BINANCE:BTC/USDT.P')).toBeNull()
  })

  it('Case 8e: BINANCE:BTCUSDTPERP → null (PERP 변형)', () => {
    expect(normalizeBinanceSymbol('BINANCE:BTCUSDTPERP')).toBeNull()
  })

  it('Case 9: TV API 없음 → raw empty string, binanceSymbol null', () => {
    setMockWidget(null)
    const r = readCurrentSymbol()
    expect(r.raw).toBe('')
    expect(r.binanceSymbol).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Case 10~11: waitForTvChart
// ---------------------------------------------------------------------------

describe('waitForTvChart', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('Case 10: chart hydrated → resolve (250ms poll 이내)', async () => {
    // 750ms 후 widget 주입 시뮬레이션
    setTimeout(() => {
      setMockWidget({
        lineToolsAndGroupsDTO: () => new Map(),
        symbol: () => 'BINANCE:BTCUSDT',
      })
    }, 600)

    const promise = waitForTvChart(5000)
    vi.advanceTimersByTime(800)
    await expect(promise).resolves.toBeDefined()
  })

  it('Case 11: timeout 초과 → reject', async () => {
    setMockWidget(null)  // widget 없음
    const promise = waitForTvChart(500)
    vi.advanceTimersByTime(600)
    await expect(promise).rejects.toThrow('timed out')
  })
})

// ---------------------------------------------------------------------------
// Case 12: readTrendlineById
// ---------------------------------------------------------------------------

describe('readTrendlineById', () => {
  it('Case 12: 존재하는 ID → TvTrendline 반환', () => {
    const dto = new Map<number, MockPaneDTO>()
    dto.set(0, makePaneDTO([
      {
        id: 'tl-abc',
        type: 'LineToolTrendLine',
        points: [{ time: 1700000000, price: 30000 }, { time: 1700003600, price: 31000 }],
      },
    ]))
    setMockWidget({ lineToolsAndGroupsDTO: () => dto, symbol: () => 'BINANCE:BTCUSDT' })

    const t = readTrendlineById('tl-abc')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('tl-abc')
  })

  it('Case 13: 없는 ID → null', () => {
    const dto = new Map<number, MockPaneDTO>()
    dto.set(0, makePaneDTO([]))
    setMockWidget({ lineToolsAndGroupsDTO: () => dto, symbol: () => 'BINANCE:BTCUSDT' })

    expect(readTrendlineById('not-exist')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Case 14: subscribeSymbolChange unsubscribe
// ---------------------------------------------------------------------------

describe('subscribeSymbolChange', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('Case 14: unsubscribe 후 콜백 호출 안됨', () => {
    setMockWidget({ symbol: () => 'BINANCE:BTCUSDT' })
    const cb = vi.fn()
    const unsub = subscribeSymbolChange(cb)
    unsub()

    // symbol 변경 시뮬레이션
    setMockWidget({ symbol: () => 'BINANCE:ETHUSDT' })
    vi.advanceTimersByTime(1000)

    expect(cb).not.toHaveBeenCalled()
  })
})
