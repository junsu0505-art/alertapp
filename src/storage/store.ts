/**
 * store.ts — GM_setValue / GM_getValue 기반 단일 키 스토리지 래퍼
 *
 * UP-15 race: GM_setValue/GM_getValue 는 Tampermonkey 자체 직렬화로 처리됨.
 * 동시 write race 없음 (단일 스크립트 컨텍스트, 순차 실행). OK.
 *
 * UP-16 secret: botToken 은 이 파일 내부 Settings wrapper 에서만 다룸.
 * hardcoded token 없음. 런타임 GM_getValue 경유 로드만.
 */

import { type Settings, type TrendlineAlert, type TelegramConfig, EMPTY_SETTINGS } from '../types.js'

const STORAGE_KEY = 'alertapp:settings'

// ---------------------------------------------------------------------------
// GM_* unavailable 환경 (vitest jsdom) 용 in-memory fallback
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    __alertapp_storage__: Record<string, string>
  }
}

function isGmAvailable(): boolean {
  return typeof GM_getValue === 'function' && typeof GM_setValue === 'function'
}

function memGet(key: string): string | undefined {
  if (typeof window !== 'undefined') {
    window.__alertapp_storage__ ??= {}
    return window.__alertapp_storage__[key]
  }
  return undefined
}

function memSet(key: string, value: string): void {
  if (typeof window !== 'undefined') {
    window.__alertapp_storage__ ??= {}
    window.__alertapp_storage__[key] = value
  }
}

// ---------------------------------------------------------------------------
// Core read / write
// ---------------------------------------------------------------------------

async function rawGet(key: string): Promise<string | undefined> {
  if (isGmAvailable()) {
    const val = await GM_getValue(key, undefined)
    return typeof val === 'string' ? val : undefined
  }
  return memGet(key)
}

async function rawSet(key: string, value: string): Promise<void> {
  if (isGmAvailable()) {
    await GM_setValue(key, value)
  } else {
    memSet(key, value)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await rawGet(STORAGE_KEY)
    if (!raw) return { ...EMPTY_SETTINGS, alerts: [] }
    return JSON.parse(raw) as Settings
  } catch {
    // corrupt JSON → EMPTY_SETTINGS fallback
    return { ...EMPTY_SETTINGS, alerts: [] }
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await rawSet(STORAGE_KEY, JSON.stringify(s))
}

export async function addAlert(alert: TrendlineAlert): Promise<void> {
  const s = await loadSettings()
  s.alerts.push(alert)
  await saveSettings(s)
}

export async function updateAlert(id: string, patch: Partial<TrendlineAlert>): Promise<void> {
  const s = await loadSettings()
  const idx = s.alerts.findIndex((a) => a.id === id)
  if (idx === -1) return
  s.alerts[idx] = { ...s.alerts[idx]!, ...patch }
  await saveSettings(s)
}

export async function removeAlert(id: string): Promise<void> {
  const s = await loadSettings()
  s.alerts = s.alerts.filter((a) => a.id !== id)
  await saveSettings(s)
}

export async function setTelegramConfig(cfg: TelegramConfig): Promise<void> {
  const s = await loadSettings()
  s.telegram = cfg
  await saveSettings(s)
}

export async function getTelegramConfig(): Promise<TelegramConfig | null> {
  const s = await loadSettings()
  return s.telegram
}
