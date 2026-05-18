import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { sendTelegramMessage } from '../src/notify/telegram.js'
import type { TelegramConfig } from '../src/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_CFG: TelegramConfig = {
  botToken: 'test_bot_token_123',
  chatId: '987654321',
}

function makeFetchMock(status: number, body: unknown = { ok: true }): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response)
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // GM_xmlhttpRequest 는 jsdom 에 없음 — undefined 유지 (fetch fallback 경로 활성)
  delete (globalThis as Record<string, unknown>).GM_xmlhttpRequest
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Test Cases
// ---------------------------------------------------------------------------

describe('sendTelegramMessage', () => {
  // Case 1: 정상 전송 (200) → { ok: true, status: 200 }
  it('Case 1: 200 OK → { ok: true, status: 200 }', async () => {
    globalThis.fetch = makeFetchMock(200, { ok: true, result: { message_id: 1 } })

    const result = await sendTelegramMessage(VALID_CFG, 'Hello Telegram!')

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.error).toBeUndefined()
  })

  // Case 2: 401 invalid token → { ok: false, status: 401, error: 'http_401' }
  it('Case 2: 401 Unauthorized → { ok: false, status: 401 }', async () => {
    globalThis.fetch = makeFetchMock(401, { ok: false, description: 'Unauthorized' })

    const result = await sendTelegramMessage(VALID_CFG, 'test')

    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
    expect(result.error).toBe('http_401')
  })

  // Case 3: 429 rate limit → { ok: false, status: 429 }
  it('Case 3: 429 rate limit → { ok: false, status: 429 } (Retry-After 보고만, 재시도 X)', async () => {
    globalThis.fetch = makeFetchMock(429, {
      ok: false,
      description: 'Too Many Requests: retry after 30',
      parameters: { retry_after: 30 },
    })

    const result = await sendTelegramMessage(VALID_CFG, 'rate limit test')

    expect(result.ok).toBe(false)
    expect(result.status).toBe(429)
    expect(result.error).toBe('http_429')
    // 자동 재시도 없음 — fetch 는 1회 호출
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  // Case 4: botToken 빈 문자열 → { ok: false, error: 'missing_token' } (fetch 호출 X)
  it('Case 4: botToken 빈 문자열 → { ok: false, error: "missing_token" }, fetch 미호출', async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy

    const result = await sendTelegramMessage({ botToken: '', chatId: '12345' }, 'should not send')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('missing_token')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // Case 5 (bonus): network error (fetch reject) → { ok: false, error: 'network_error: ...' }
  it('Case 5: fetch network reject → { ok: false, error starts with "network_error" }', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to connect'))

    const result = await sendTelegramMessage(VALID_CFG, 'network test')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/^network_error:/)
  })

  // Case 6 (bonus): GM_xmlhttpRequest 존재 시 fetch 호출 X
  it('Case 6: GM_xmlhttpRequest 존재 시 fetch 미호출, GM 우선', async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy

    // GM_xmlhttpRequest mock: onload 즉시 호출
    const gmMock = vi.fn().mockImplementation((opts: {
      onload?: (r: { status: number; statusText: string; response: string; responseText: string; responseHeaders: string; readyState: number; responseXML: null; finalUrl: string; context: undefined }) => void
    }) => {
      // setTimeout 0으로 비동기 처리 (실제 GM 동작 시뮬레이션)
      setTimeout(() => {
        opts.onload?.({
          status: 200,
          statusText: 'OK',
          response: '{"ok":true}',
          responseText: '{"ok":true}',
          responseHeaders: '',
          readyState: 4,
          responseXML: null,
          finalUrl: '',
          context: undefined,
        })
      }, 0)
    })

    ;(globalThis as Record<string, unknown>).GM_xmlhttpRequest = gmMock

    const result = await sendTelegramMessage(VALID_CFG, 'GM test')

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(gmMock).toHaveBeenCalledTimes(1)
  })

  // Case 7 (bonus): 4096+ 글자 text → truncate + '...' 마커
  it('Case 7: 4096+ 글자 text → 4096자로 truncate (마지막 3자는 "...")', async () => {
    globalThis.fetch = makeFetchMock(200)

    const longText = 'A'.repeat(5000)

    await sendTelegramMessage(VALID_CFG, longText)

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    const body = JSON.parse(callArgs[1].body as string) as { text: string }

    expect(body.text.length).toBe(4096)
    expect(body.text.endsWith('...')).toBe(true)
    expect(body.text.startsWith('A')).toBe(true)
  })
})
