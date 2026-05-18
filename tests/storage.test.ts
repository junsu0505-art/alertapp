import { beforeEach, describe, it, expect } from 'vitest'
import {
  loadSettings,
  saveSettings,
  addAlert,
  removeAlert,
  updateAlert,
  setTelegramConfig,
  getTelegramConfig,
} from '../src/storage/store.js'
import type { TrendlineAlert, Settings } from '../src/types.js'
import { EMPTY_SETTINGS } from '../src/types.js'

// ---------------------------------------------------------------------------
// Setup: in-memory fallback reset + GM_* stubs (unavailable in jsdom)
// ---------------------------------------------------------------------------

function resetStorage(): void {
  if (typeof window !== 'undefined') {
    (window as Window & { __alertapp_storage__?: Record<string, string> }).__alertapp_storage__ = {}
  }
}

// GM_* are not available in jsdom — ensure isGmAvailable() returns false
// by not stubbing them (they remain undefined). No action needed.

beforeEach(() => {
  resetStorage()
})

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

// ---------------------------------------------------------------------------
// Test Cases
// ---------------------------------------------------------------------------

describe('storage/store', () => {
  // Case 1: 초기 load → EMPTY_SETTINGS
  it('Case 1: loadSettings 초기 → EMPTY_SETTINGS', async () => {
    const s = await loadSettings()
    expect(s.telegram).toBeNull()
    expect(s.alerts).toHaveLength(0)
  })

  // Case 2: saveSettings 후 loadSettings round-trip
  it('Case 2: saveSettings → loadSettings round-trip', async () => {
    const target: Settings = {
      telegram: { botToken: 'tok_abc', chatId: '12345' },
      alerts: [makeAlert()],
    }
    await saveSettings(target)
    const loaded = await loadSettings()
    expect(loaded.telegram?.chatId).toBe('12345')
    expect(loaded.alerts).toHaveLength(1)
    expect(loaded.alerts[0]?.symbol).toBe('BTCUSDT')
  })

  // Case 3: addAlert 후 alerts.length === 1
  it('Case 3: addAlert 후 alerts.length === 1', async () => {
    const alert = makeAlert()
    await addAlert(alert)
    const s = await loadSettings()
    expect(s.alerts).toHaveLength(1)
    expect(s.alerts[0]?.id).toBe(alert.id)
  })

  // Case 4: removeAlert 후 alerts.length === 0
  it('Case 4: removeAlert 후 alerts.length === 0', async () => {
    const alert = makeAlert()
    await addAlert(alert)
    await removeAlert(alert.id)
    const s = await loadSettings()
    expect(s.alerts).toHaveLength(0)
  })

  // Case 5: updateAlert status 변경
  it('Case 5: updateAlert status triggered 로 변경', async () => {
    const alert = makeAlert({ status: 'armed' })
    await addAlert(alert)
    await updateAlert(alert.id, { status: 'triggered', triggeredAt: 1700005000 })
    const s = await loadSettings()
    expect(s.alerts[0]?.status).toBe('triggered')
    expect(s.alerts[0]?.triggeredAt).toBe(1700005000)
  })

  // Case 6: setTelegramConfig 후 getTelegramConfig 동일 반환
  it('Case 6: setTelegramConfig → getTelegramConfig 동일 반환', async () => {
    await setTelegramConfig({ botToken: 'bot_xyz', chatId: '99999' })
    const cfg = await getTelegramConfig()
    expect(cfg?.botToken).toBe('bot_xyz')
    expect(cfg?.chatId).toBe('99999')
  })

  // Case 7 (bonus): corrupt JSON → EMPTY_SETTINGS fallback
  it('Case 7: corrupt JSON → EMPTY_SETTINGS fallback', async () => {
    // 직접 in-memory store 에 corrupt 데이터 주입
    if (typeof window !== 'undefined') {
      (window as Window & { __alertapp_storage__?: Record<string, string> }).__alertapp_storage__ = {
        'alertapp:settings': '{ broken json :::',
      }
    }
    const s = await loadSettings()
    expect(s.telegram).toBeNull()
    expect(s.alerts).toHaveLength(0)
  })
})
