/**
 * widget.ts — TradingView 페이지 우상단 floating button + popup panel
 *
 * GM_addStyle / z-index 99999 namespaced 클래스 방식으로 inject.
 * 다크 테마 (#1e222d / #2a2e39 / #d1d4dc) — TV 색상 팔레트와 일치.
 *
 * UP-15 race: mountWidget 중복 호출 차단 (isMounted flag). destroy 후 재 mount OK.
 * UP-16 secret: bot token input type='password'. console.log 0. DOM attribute 노출 X.
 * UP-15 resource: destroy() 시 DOM 제거 + event listener 정리.
 */

import type { TrendlineAlert } from '../types.js'
import { readAllTrendlines } from './dom.js'

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

export interface WidgetOpts {
  onAddAlert: (direction: 'cross_above' | 'cross_below') => Promise<void>
  onRemoveAlert: (id: string) => Promise<void>
  onSetTelegramConfig: (botToken: string, chatId: string) => Promise<void>
  getAlerts: () => Promise<TrendlineAlert[]>
  getTelegramConfig: () => Promise<{ botToken: string; chatId: string } | null>
}

export interface WidgetHandle {
  destroy: () => void
  refresh: () => Promise<void>
}

// ---------------------------------------------------------------------------
// CSS (GM_addStyle / style 태그)
// ---------------------------------------------------------------------------

const CSS = `
.aa-btn {
  position: fixed;
  right: 16px;
  top: 80px;
  z-index: 99999;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #2a2e39;
  border: 1px solid #363a45;
  color: #d1d4dc;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,.4);
  user-select: none;
  transition: background .15s;
}
.aa-btn:hover { background: #363a45; }
.aa-count {
  position: absolute;
  top: -4px;
  right: -4px;
  background: #f23645;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  border-radius: 8px;
  padding: 1px 4px;
  line-height: 14px;
  min-width: 14px;
  text-align: center;
}
.aa-panel {
  position: fixed;
  right: 64px;
  top: 80px;
  z-index: 99999;
  width: 320px;
  background: #1e222d;
  border: 1px solid #363a45;
  border-radius: 8px;
  color: #d1d4dc;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  box-shadow: 0 4px 24px rgba(0,0,0,.5);
  display: none;
}
.aa-panel.aa-open { display: block; }
.aa-panel-header {
  padding: 10px 14px;
  border-bottom: 1px solid #363a45;
  font-weight: 600;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.aa-section {
  padding: 10px 14px;
  border-bottom: 1px solid #2a2e39;
}
.aa-section-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: #787b86;
  margin-bottom: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  user-select: none;
}
.aa-section-title:hover { color: #d1d4dc; }
.aa-tg-body { display: none; }
.aa-tg-body.aa-open { display: block; }
.aa-input {
  width: 100%;
  box-sizing: border-box;
  background: #2a2e39;
  border: 1px solid #363a45;
  border-radius: 4px;
  color: #d1d4dc;
  padding: 5px 8px;
  font-size: 12px;
  margin-bottom: 6px;
  outline: none;
}
.aa-input:focus { border-color: #2196f3; }
.aa-btn-sm {
  background: #2196f3;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: background .15s;
}
.aa-btn-sm:hover { background: #1976d2; }
.aa-tg-warn {
  color: #f23645;
  font-size: 11px;
  margin-top: 4px;
}
.aa-alert-list { max-height: 200px; overflow-y: auto; }
.aa-alert-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 0;
  border-bottom: 1px solid #2a2e39;
}
.aa-alert-item:last-child { border-bottom: none; }
.aa-alert-info { flex: 1; font-size: 12px; min-width: 0; }
.aa-alert-sym { font-weight: 600; color: #d1d4dc; }
.aa-alert-dir {
  font-size: 11px;
  color: #787b86;
}
.aa-badge {
  font-size: 10px;
  border-radius: 3px;
  padding: 1px 5px;
  font-weight: 600;
}
.aa-badge-armed { background: #1a3a4a; color: #26a69a; }
.aa-badge-triggered { background: #3a1a1a; color: #f23645; }
.aa-badge-paused { background: #2a2e39; color: #787b86; }
.aa-del-btn {
  background: none;
  border: none;
  color: #787b86;
  cursor: pointer;
  font-size: 15px;
  padding: 0 4px;
  line-height: 1;
  transition: color .15s;
}
.aa-del-btn:hover { color: #f23645; }
.aa-empty { color: #787b86; font-size: 12px; padding: 4px 0; }
.aa-add-section { padding: 10px 14px; }
.aa-add-btn {
  width: 100%;
  background: #26a69a;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 7px 0;
  font-size: 13px;
  cursor: pointer;
  transition: background .15s;
}
.aa-add-btn:hover { background: #1d8a7f; }
.aa-dir-dialog {
  position: fixed;
  z-index: 100000;
  background: #1e222d;
  border: 1px solid #363a45;
  border-radius: 8px;
  padding: 14px;
  color: #d1d4dc;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  box-shadow: 0 4px 24px rgba(0,0,0,.6);
  display: none;
  min-width: 200px;
}
.aa-dir-dialog.aa-open { display: block; }
.aa-dir-title { font-weight: 600; margin-bottom: 10px; }
.aa-dir-btns { display: flex; gap: 8px; }
.aa-dir-btn {
  flex: 1;
  background: #2a2e39;
  border: 1px solid #363a45;
  border-radius: 4px;
  color: #d1d4dc;
  padding: 7px 0;
  font-size: 12px;
  cursor: pointer;
  transition: background .15s;
  text-align: center;
}
.aa-dir-btn:hover { background: #363a45; }
.aa-dir-cancel {
  margin-top: 8px;
  width: 100%;
  background: none;
  border: none;
  color: #787b86;
  font-size: 12px;
  cursor: pointer;
  padding: 4px 0;
}
.aa-dir-cancel:hover { color: #d1d4dc; }
`

// ---------------------------------------------------------------------------
// 중복 mount 차단 (UP-15 race)
// ---------------------------------------------------------------------------

let _isMounted = false

// ---------------------------------------------------------------------------
// mountWidget
// ---------------------------------------------------------------------------

/**
 * 페이지 우상단에 floating button + popup panel inject.
 * 중복 호출 시 destroy → 재 mount.
 */
export function mountWidget(opts: WidgetOpts): WidgetHandle {
  // 중복 mount 차단 — 이미 mounted 이면 destroy 요구. 직접 방어.
  if (_isMounted) {
    // 기존 위젯 teardown (외부에서 destroy 호출 않고 재호출 시)
    const existing = document.getElementById('aa-root')
    existing?.remove()
    const existingStyle = document.getElementById('aa-style')
    existingStyle?.remove()
    _isMounted = false
  }

  _isMounted = true

  // ── CSS inject ─────────────────────────────────────────────────────────
  const styleEl = document.createElement('style')
  styleEl.id = 'aa-style'
  styleEl.textContent = CSS
  document.head.appendChild(styleEl)

  // ── Root container ─────────────────────────────────────────────────────
  const root = document.createElement('div')
  root.id = 'aa-root'
  document.body.appendChild(root)

  // ── Floating button ────────────────────────────────────────────────────
  const btn = document.createElement('button')
  btn.className = 'aa-btn'
  btn.setAttribute('aria-label', '알람 위젯 열기')
  btn.innerHTML = '<span style="position:relative;display:inline-flex;align-items:center;justify-content:center">🔔<span class="aa-count" id="aa-count" style="display:none">0</span></span>'
  root.appendChild(btn)

  // ── Panel ──────────────────────────────────────────────────────────────
  const panel = document.createElement('div')
  panel.className = 'aa-panel'
  panel.id = 'aa-panel'
  panel.innerHTML = `
    <div class="aa-panel-header">🔔 alertapp</div>

    <div class="aa-section">
      <div class="aa-section-title" id="aa-tg-toggle">
        <span id="aa-tg-arrow">▶</span> Telegram 설정
        <span id="aa-tg-warn-icon"></span>
      </div>
      <div class="aa-tg-body" id="aa-tg-body">
        <input class="aa-input" id="aa-tg-token" type="password" placeholder="Bot Token" autocomplete="new-password" />
        <input class="aa-input" id="aa-tg-chat" type="text" placeholder="Chat ID" autocomplete="off" />
        <button class="aa-btn-sm" id="aa-tg-save">저장</button>
      </div>
    </div>

    <div class="aa-section">
      <div class="aa-section-title">알람 목록</div>
      <div class="aa-alert-list" id="aa-alert-list">
        <div class="aa-empty">알람 없음</div>
      </div>
    </div>

    <div class="aa-add-section">
      <button class="aa-add-btn" id="aa-add-btn">+ Alert 추가</button>
    </div>
  `
  root.appendChild(panel)

  // ── Direction dialog ───────────────────────────────────────────────────
  const dirDialog = document.createElement('div')
  dirDialog.className = 'aa-dir-dialog'
  dirDialog.id = 'aa-dir-dialog'
  dirDialog.innerHTML = `
    <div class="aa-dir-title">방향 선택</div>
    <div class="aa-dir-btns">
      <button class="aa-dir-btn" id="aa-dir-above">위로 cross</button>
      <button class="aa-dir-btn" id="aa-dir-below">아래로 cross</button>
    </div>
    <button class="aa-dir-cancel" id="aa-dir-cancel">취소</button>
  `
  root.appendChild(dirDialog)

  // ── 내부 상태 ──────────────────────────────────────────────────────────
  let pendingTrendlineId: string | null = null
  let tgCollapsed = true

  // ── 헬퍼: count badge ──────────────────────────────────────────────────
  function updateCount(count: number): void {
    const el = document.getElementById('aa-count')
    if (!el) return
    if (count > 0) {
      el.textContent = String(count)
      el.style.display = 'block'
    } else {
      el.style.display = 'none'
    }
  }

  // ── 헬퍼: alert 목록 렌더 ─────────────────────────────────────────────
  function renderAlerts(alerts: TrendlineAlert[]): void {
    const list = document.getElementById('aa-alert-list')
    if (!list) return
    list.innerHTML = ''

    if (alerts.length === 0) {
      list.innerHTML = '<div class="aa-empty">알람 없음</div>'
      return
    }

    alerts.forEach((a) => {
      const item = document.createElement('div')
      item.className = 'aa-alert-item'

      const dirLabel = a.direction === 'cross_above' ? '↑ 위로 cross' : '↓ 아래로 cross'
      const badgeClass =
        a.status === 'armed'
          ? 'aa-badge-armed'
          : a.status === 'triggered'
            ? 'aa-badge-triggered'
            : 'aa-badge-paused'
      const statusLabel =
        a.status === 'armed' ? '대기' : a.status === 'triggered' ? '발화' : '정지'

      item.innerHTML = `
        <div class="aa-alert-info">
          <div class="aa-alert-sym">${escHtml(a.symbol)}</div>
          <div class="aa-alert-dir">${dirLabel} | ${escHtml(a.tfLabel)}</div>
        </div>
        <span class="aa-badge ${badgeClass}">${statusLabel}</span>
        <button class="aa-del-btn" data-id="${escHtml(a.id)}" aria-label="알람 삭제">✕</button>
      `

      const delBtn = item.querySelector('.aa-del-btn')
      delBtn?.addEventListener('click', () => {
        opts.onRemoveAlert(a.id).then(() => refreshInternal()).catch(console.warn)
      })

      list.appendChild(item)
    })
  }

  // ── 헬퍼: Telegram 설정 로드 ───────────────────────────────────────────
  async function loadTgConfig(): Promise<void> {
    try {
      const cfg = await opts.getTelegramConfig()
      const warnIcon = document.getElementById('aa-tg-warn-icon')
      if (!cfg) {
        if (warnIcon) warnIcon.textContent = ' ⚠️'
      } else {
        if (warnIcon) warnIcon.textContent = ''
        // token 은 placeholder 로만 표시 (보안: DOM attribute 에 값 노출 X)
        const tokenInput = document.getElementById('aa-tg-token') as HTMLInputElement | null
        const chatInput = document.getElementById('aa-tg-chat') as HTMLInputElement | null
        if (tokenInput) tokenInput.placeholder = '저장됨 (변경 시 입력)'
        if (chatInput) chatInput.value = cfg.chatId
      }
    } catch (e) {
      console.warn('alertapp: Telegram 설정 로드 실패', e)
    }
  }

  // ── 내부 refresh ────────────────────────────────────────────────────────
  async function refreshInternal(): Promise<void> {
    try {
      const alerts = await opts.getAlerts()
      renderAlerts(alerts)
      updateCount(alerts.filter((a) => a.status === 'armed').length)
      await loadTgConfig()
    } catch (e) {
      console.warn('alertapp: refresh 실패', e)
    }
  }

  // ── 이벤트: toggle panel ───────────────────────────────────────────────
  btn.addEventListener('click', () => {
    panel.classList.toggle('aa-open')
    if (panel.classList.contains('aa-open')) {
      refreshInternal().catch(console.warn)
    }
  })

  // ── 이벤트: Telegram 섹션 접기/펼치기 ─────────────────────────────────
  const tgToggle = document.getElementById('aa-tg-toggle')
  tgToggle?.addEventListener('click', () => {
    tgCollapsed = !tgCollapsed
    const body = document.getElementById('aa-tg-body')
    const arrow = document.getElementById('aa-tg-arrow')
    if (body) body.classList.toggle('aa-open', !tgCollapsed)
    if (arrow) arrow.textContent = tgCollapsed ? '▶' : '▼'
  })

  // ── 이벤트: Telegram 저장 ─────────────────────────────────────────────
  const tgSaveBtn = document.getElementById('aa-tg-save')
  tgSaveBtn?.addEventListener('click', () => {
    const tokenEl = document.getElementById('aa-tg-token') as HTMLInputElement | null
    const chatEl = document.getElementById('aa-tg-chat') as HTMLInputElement | null
    const token = tokenEl?.value?.trim() ?? ''
    const chatId = chatEl?.value?.trim() ?? ''

    if (!token || !chatId) {
      alert('Bot Token 과 Chat ID 를 모두 입력해주세요.')
      return
    }

    opts
      .onSetTelegramConfig(token, chatId)
      .then(() => {
        if (tokenEl) {
          tokenEl.value = ''
          tokenEl.placeholder = '저장됨 (변경 시 입력)'
        }
        loadTgConfig().catch(console.warn)
      })
      .catch((e: unknown) => {
        console.warn('alertapp: Telegram 저장 실패', e)
        alert('저장 실패. 콘솔을 확인해주세요.')
      })
  })

  // ── 이벤트: + Alert 추가 ───────────────────────────────────────────────
  const addBtn = document.getElementById('aa-add-btn')
  addBtn?.addEventListener('click', () => {
    try {
      const trendlines = readAllTrendlines()
      if (trendlines.length === 0) {
        alert('먼저 추세선을 그려주세요.')
        return
      }

      // 마지막 trendline 사용 (v1.5+ 에서 선택 UI 추가)
      const last = trendlines[trendlines.length - 1]!
      if (trendlines.length > 1) {
        alert(`추세선이 ${trendlines.length}개 감지됐습니다. 가장 최근 그린 추세선을 사용합니다.`)
      }

      pendingTrendlineId = last.id

      // direction dialog 표시
      const dd = document.getElementById('aa-dir-dialog')
      if (dd) {
        dd.classList.add('aa-open')
        // panel 아래 위치 조정
        const panelRect = panel.getBoundingClientRect()
        dd.style.top = `${panelRect.bottom + 8}px`
        dd.style.right = '16px'
      }
    } catch (e) {
      console.warn('alertapp: Alert 추가 실패', e)
    }
  })

  // ── 이벤트: direction 선택 ─────────────────────────────────────────────
  function closeDirDialog(): void {
    const dd = document.getElementById('aa-dir-dialog')
    dd?.classList.remove('aa-open')
    pendingTrendlineId = null
  }

  document.getElementById('aa-dir-above')?.addEventListener('click', () => {
    closeDirDialog()
    opts.onAddAlert('cross_above').then(() => refreshInternal()).catch(console.warn)
  })

  document.getElementById('aa-dir-below')?.addEventListener('click', () => {
    closeDirDialog()
    opts.onAddAlert('cross_below').then(() => refreshInternal()).catch(console.warn)
  })

  document.getElementById('aa-dir-cancel')?.addEventListener('click', closeDirDialog)

  // 초기 로드
  refreshInternal().catch(console.warn)

  // ── WidgetHandle ───────────────────────────────────────────────────────
  return {
    destroy(): void {
      root.remove()
      styleEl.remove()
      _isMounted = false
    },
    async refresh(): Promise<void> {
      await refreshInternal()
    },
  }
}

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
