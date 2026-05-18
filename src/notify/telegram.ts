import type { TelegramConfig } from '../types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendResult {
  ok: boolean
  status?: number
  error?: string
}

type ParseMode = 'HTML' | 'MarkdownV2'

interface SendOptions {
  parseMode?: ParseMode | 'plain'
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TELEGRAM_API_BASE = 'https://api.telegram.org'
const MAX_TEXT_LENGTH = 4096
const TRUNCATE_MARKER = '...'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text
  return text.slice(0, MAX_TEXT_LENGTH - TRUNCATE_MARKER.length) + TRUNCATE_MARKER
}

function buildPayload(
  cfg: TelegramConfig,
  text: string,
  opts?: SendOptions,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    chat_id: cfg.chatId,
    text: truncateText(text),
  }

  if (opts?.parseMode && opts.parseMode !== 'plain') {
    payload['parse_mode'] = opts.parseMode
  }

  return payload
}

// ---------------------------------------------------------------------------
// GM_xmlhttpRequest wrapper (Tampermonkey 환경)
// ---------------------------------------------------------------------------

function sendViaGM(url: string, body: string): Promise<SendResult> {
  return new Promise((resolve) => {
    GM_xmlhttpRequest({
      method: 'POST',
      url,
      headers: { 'Content-Type': 'application/json' },
      data: body,
      onload(response) {
        try {
          const status = response.status
          if (status >= 200 && status < 300) {
            resolve({ ok: true, status })
          } else {
            resolve({ ok: false, status, error: `http_${status}` })
          }
        } catch (e) {
          resolve({ ok: false, error: 'gm_parse_error' })
        }
      },
      onerror(response) {
        resolve({ ok: false, status: response.status, error: 'gm_network_error' })
      },
    })
  })
}

// ---------------------------------------------------------------------------
// fetch wrapper (vitest/jsdom 환경 또는 Tampermonkey GM 미존재 시 fallback)
// ---------------------------------------------------------------------------

async function sendViaFetch(url: string, body: string): Promise<SendResult> {
  const response = await globalThis.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })

  const status = response.status

  if (status >= 200 && status < 300) {
    return { ok: true, status }
  }

  return { ok: false, status, error: `http_${status}` }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Telegram Bot API sendMessage.
 *
 * - Tampermonkey 환경 (typeof GM_xmlhttpRequest !== 'undefined'):
 *   GM_xmlhttpRequest 사용 — CORS bypass + @connect api.telegram.org 필요.
 * - 그 외 (vitest/jsdom 등): globalThis.fetch fallback.
 *
 * 에러 처리:
 *   - missing_token: botToken 빈 문자열 → 즉시 반환 (네트워크 호출 X)
 *   - http_401: 잘못된 bot token
 *   - http_429: rate limit (Retry-After 헤더는 HTTP 레이어에서 반환됨, 자동 재시도 X v1)
 *   - network_error: fetch/GM reject
 */
export async function sendTelegramMessage(
  cfg: TelegramConfig,
  text: string,
  opts?: SendOptions,
): Promise<SendResult> {
  // 입력 검증
  if (!cfg.botToken) {
    return { ok: false, error: 'missing_token' }
  }

  if (!cfg.chatId) {
    return { ok: false, error: 'missing_chat_id' }
  }

  const url = `${TELEGRAM_API_BASE}/bot${cfg.botToken}/sendMessage`
  const body = JSON.stringify(buildPayload(cfg, text, opts))

  try {
    if (typeof GM_xmlhttpRequest !== 'undefined') {
      return await sendViaGM(url, body)
    }
    return await sendViaFetch(url, body)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `network_error: ${message}` }
  }
}
