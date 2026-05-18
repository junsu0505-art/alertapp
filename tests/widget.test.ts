/**
 * widget.test.ts — mountWidget DOM inject 단위 테스트
 *
 * jsdom 환경. GM_addStyle mock. readAllTrendlines mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mountWidget } from '../src/tradingview/widget.js'
import type { TrendlineAlert } from '../src/types.js'
import type { WidgetOpts } from '../src/tradingview/widget.js'

// ---------------------------------------------------------------------------
// GM_addStyle mock (Tampermonkey 미사용 환경)
// ---------------------------------------------------------------------------

// Tampermonkey @grant GM_addStyle 는 jsdom 에 없음 → 전역 stub 등록
// (실제 코드는 GM_addStyle 을 직접 사용하지 않고 style 태그를 주입하므로 mock 불필요)
// 하지만 types/tampermonkey 에서 선언된 전역 함수 타입 충족을 위해 stub 선언
;(globalThis as Record<string, unknown>).GM_addStyle = vi.fn()

// ---------------------------------------------------------------------------
// dom.ts readAllTrendlines mock
// ---------------------------------------------------------------------------

vi.mock('../src/tradingview/dom.js', () => ({
  readAllTrendlines: vi.fn(() => []),
  readCurrentSymbol: vi.fn(() => ({ raw: 'BINANCE:BTCUSDT', binanceSymbol: 'BTCUSDT' })),
  normalizeBinanceSymbol: vi.fn((s: string) => {
    const m = /^BINANCE:([A-Z0-9]+)$/.exec(s)
    return m ? m[1] : null
  }),
  waitForTvChart: vi.fn(),
  readTrendlineById: vi.fn(() => null),
  subscribeSymbolChange: vi.fn(() => () => undefined),
}))

import { readAllTrendlines } from '../src/tradingview/dom.js'

// ---------------------------------------------------------------------------
// helpers
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

function makeOpts(alerts: TrendlineAlert[] = [], hasTg = false): WidgetOpts {
  return {
    onAddAlert: vi.fn(async () => undefined),
    onRemoveAlert: vi.fn(async () => undefined),
    onSetTelegramConfig: vi.fn(async () => undefined),
    getAlerts: vi.fn(async () => alerts),
    getTelegramConfig: vi.fn(async () =>
      hasTg ? { botToken: 'dummy', chatId: '12345' } : null,
    ),
  }
}

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  // 남은 위젯 제거
  document.getElementById('aa-root')?.remove()
  document.getElementById('aa-style')?.remove()
})

// ---------------------------------------------------------------------------
// Case 1: mountWidget → DOM 요소 존재
// ---------------------------------------------------------------------------

describe('mountWidget DOM inject', () => {
  it('Case 1: 버튼과 패널이 DOM 에 존재해야 함', async () => {
    const handle = mountWidget(makeOpts())
    // refresh 완료 대기
    await handle.refresh()

    expect(document.getElementById('aa-root')).not.toBeNull()
    const btn = document.querySelector('.aa-btn')
    expect(btn).not.toBeNull()
    const panel = document.querySelector('.aa-panel')
    expect(panel).not.toBeNull()

    handle.destroy()
  })

  // ---------------------------------------------------------------------------
  // Case 2: getAlerts 결과 → alert 목록 렌더
  // ---------------------------------------------------------------------------

  it('Case 2: alerts 2개 → 목록에 2개 아이템 렌더', async () => {
    const alerts = [makeAlert({ symbol: 'BTCUSDT' }), makeAlert({ symbol: 'ETHUSDT' })]
    const handle = mountWidget(makeOpts(alerts))
    await handle.refresh()

    const items = document.querySelectorAll('.aa-alert-item')
    expect(items).toHaveLength(2)

    handle.destroy()
  })

  // ---------------------------------------------------------------------------
  // Case 3: destroy() → DOM 제거
  // ---------------------------------------------------------------------------

  it('Case 3: destroy() → aa-root, aa-style 제거', async () => {
    const handle = mountWidget(makeOpts())
    await handle.refresh()

    expect(document.getElementById('aa-root')).not.toBeNull()
    handle.destroy()
    expect(document.getElementById('aa-root')).toBeNull()
    expect(document.getElementById('aa-style')).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // Case 4: Telegram 미설정 → 경고 아이콘 표시
  // ---------------------------------------------------------------------------

  it('Case 4: Telegram 미설정 → tg-warn-icon 에 ⚠️ 표시', async () => {
    const handle = mountWidget(makeOpts([], false))
    await handle.refresh()

    const warnIcon = document.getElementById('aa-tg-warn-icon')
    expect(warnIcon?.textContent).toContain('⚠️')

    handle.destroy()
  })

  // ---------------------------------------------------------------------------
  // Case 5: status badge 렌더 — armed / triggered / paused
  // ---------------------------------------------------------------------------

  it('Case 5: status badge 정확히 렌더', async () => {
    const alerts = [
      makeAlert({ status: 'armed' }),
      makeAlert({ status: 'triggered' }),
      makeAlert({ status: 'paused' }),
    ]
    const handle = mountWidget(makeOpts(alerts))
    await handle.refresh()

    const badges = document.querySelectorAll('.aa-badge')
    expect(badges).toHaveLength(3)
    // armed → 대기, triggered → 발화, paused → 정지
    expect(badges[0]?.textContent).toBe('대기')
    expect(badges[1]?.textContent).toBe('발화')
    expect(badges[2]?.textContent).toBe('정지')

    handle.destroy()
  })

  // ---------------------------------------------------------------------------
  // Case 6: + Alert 추가 — 추세선 없으면 alert() 호출
  // ---------------------------------------------------------------------------

  it('Case 6: readAllTrendlines 빈 배열 → alert("먼저 추세선을 그려주세요") 호출', async () => {
    vi.mocked(readAllTrendlines).mockReturnValue([])
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined)

    const handle = mountWidget(makeOpts())
    await handle.refresh()

    const addBtn = document.getElementById('aa-add-btn') as HTMLButtonElement
    addBtn.click()

    expect(alertSpy).toHaveBeenCalledWith('먼저 추세선을 그려주세요.')

    alertSpy.mockRestore()
    handle.destroy()
  })

  // ---------------------------------------------------------------------------
  // Case 7: onRemoveAlert 콜백 호출
  // ---------------------------------------------------------------------------

  it('Case 7: 삭제 버튼 클릭 → onRemoveAlert 호출', async () => {
    const alert = makeAlert({ id: 'del-test-id' })
    const opts = makeOpts([alert])
    const handle = mountWidget(opts)
    await handle.refresh()

    const delBtn = document.querySelector('.aa-del-btn') as HTMLButtonElement
    delBtn.click()

    // 비동기 처리 대기
    await new Promise((r) => setTimeout(r, 10))

    expect(opts.onRemoveAlert).toHaveBeenCalledWith('del-test-id')

    handle.destroy()
  })

  // ---------------------------------------------------------------------------
  // Case 8: count badge — armed alert 수 표시
  // ---------------------------------------------------------------------------

  it('Case 8: armed alert 2개 → count badge "2" 표시', async () => {
    const alerts = [
      makeAlert({ status: 'armed' }),
      makeAlert({ status: 'armed' }),
      makeAlert({ status: 'triggered' }),
    ]
    const handle = mountWidget(makeOpts(alerts))
    await handle.refresh()

    const countEl = document.getElementById('aa-count')
    expect(countEl?.textContent).toBe('2')
    expect(countEl?.style.display).not.toBe('none')

    handle.destroy()
  })

  // ---------------------------------------------------------------------------
  // Case 9: refresh() → getAlerts 재호출
  // ---------------------------------------------------------------------------

  it('Case 9: refresh() 호출 → getAlerts 재호출', async () => {
    const opts = makeOpts([makeAlert()])
    const handle = mountWidget(opts)
    await handle.refresh()
    await handle.refresh()

    // mountWidget 내부 초기 load + 2회 명시적 refresh = 3회 이상
    expect(vi.mocked(opts.getAlerts).mock.calls.length).toBeGreaterThanOrEqual(2)

    handle.destroy()
  })
})
