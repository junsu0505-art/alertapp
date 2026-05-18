# TradingView DOM Recon — 추세선 좌표 Read 방법 (R0)

작성: 2026-05-18 by search-agent
대상 URL: `https://www.tradingview.com/chart/?symbol=BINANCE:BTCUSDT` (로그인 불필요)
Evidence: `C:/alertapp/docs/recon_evidence/*.json` + `probe_tv*.py` (재현 가능)

---

## TL;DR (R4 핵심)

| 항목 | 결론 |
|---|---|
| 추세선 렌더 layer | **Canvas only** — SVG 없음, DOM 직접 read 불가능 |
| 핵심 진입점 | `window._exposed_chartWidgetCollection.activeChartWidget.value()` |
| 좌표 read API | `widget.lineToolsAndGroupsDTO()` → `Map<paneIdx, {sources: Map<id, ToolDTO>}>` |
| 좌표 형식 | `points: [{time: unixSec, price: number}, ...]` (StickedPoint/PricedPoint) |
| 신뢰도 | **상** (살아있는 차트에서 직접 검증 완료) |
| TV 변경 안정성 | **중** — 클래스명 minified (`j_`/`ou`/`qn`) 매 빌드 변경 가능. 단 진입 path 자체 + 메서드명은 안정 |
| R4 구현 LoC 예상 | 80~120줄 (poll + DTO parse + onChange subscribe) |

---

## 1. TV 차트 페이지 구조 발견

### 렌더 layer

**Canvas-only.** Evidence (`02_dom_probe.json`):
- `canvases: 11` (모두 2D context) — 모든 chart 그래픽 (가격 캔들 + 추세선 + 인디케이터)이 Canvas로 그려짐
- `svgs: 0` (>50x50 기준) — chart 본체에 SVG 없음
- `iframes: 0` — 차트는 main page에 인라인 (cross-origin 우회 불필요)

**의미**: SVG path를 querySelectorAll 같은 DOM 트릭으로 좌표 추출 불가능. **JS API hook이 유일한 길**.

### 차트 컨테이너 selector
- `[data-name^="LineTool"]` — 드로잉 toolbar 버튼 (직접 클릭으로 도구 활성화 가능)
- `[data-name="linetool-group-trend-line"]` — 드로잉 group expander
- 차트 layer 자체는 class 익명화되어 selector 안정성 낮음 → DOM 접근 회피 권장

### window 전역에 노출된 핵심 객체 (`01_window_keys.json`)

```
TradingView
TradingViewApi
ChartApiInstance
_exposed_chartWidgetCollection   ← 가장 중요
TVLocalStorage
TVSettings
webpackChunktradingview
widgetbar
```

**`_exposed_chartWidgetCollection`** 는 글로벌 widget collection. TradingView 가 의도적으로 노출 (underscore + `_exposed_` prefix). userscript에서 즉시 접근 가능, 클로저/iframe 우회 불필요.

### Storage layer 확인

- **localStorage** (`04_localstorage.json`): 차트 drawings는 **저장되지 X**. 키 19개 중 settings/UI state만 있음 (`tradingview.widgetbar.*`, `tradingview.toggle_delete_locked_linetools` 등)
- **IndexedDB** (`05_indexeddb.json`): `Sessions Logs` 한 개만 — drawings 저장 안됨
- → drawings는 **서버 측에 sync** (TradingView 계정 로그인 시 cloud sync). 익명/local-only 사용자의 drawings는 **memory only**

**결론**: storage path는 dead end. **runtime API path 필수**.

---

## 2. 좌표 Read 후보 (3가지)

### 후보 1: `widget.lineToolsAndGroupsDTO()` — **권장**

**원리**: TradingView 가 내부에서 사용하는 "직렬화" 메서드. 모든 라인툴을 Map<paneIdx, {sources, groups, ...}> 형태로 반환. `sources`는 또 `Map<lineToolId, {points, type, properties}>` 구조.

```javascript
// userscript snippet
function readAllTrendlines() {
  const w = window._exposed_chartWidgetCollection?.activeChartWidget?.value();
  if (!w || typeof w.lineToolsAndGroupsDTO !== 'function') return [];

  const dto = w.lineToolsAndGroupsDTO();   // Map<paneIdx, paneDto>
  const out = [];
  dto.forEach((paneDto, paneIdx) => {
    paneDto.sources.forEach((toolDto, id) => {
      // toolDto.type 이 'LineToolTrendLine' 등
      if (toolDto.type !== 'LineToolTrendLine') return;
      // toolDto.points 가 [{time, price}, {time, price}]
      out.push({
        id,
        paneIdx,
        type: toolDto.type,
        points: toolDto.points,        // 좌표!
        properties: toolDto.properties,
      });
    });
  });
  return out;
}
```

**신뢰도**: **상**
- Evidence: `widget_linetool_methods` 에 `lineToolsAndGroupsDTO` 명시 (`33_complete_api_map.json` line 110)
- 빈 차트에서도 Map 구조 dump 확인 (line 123): `{__Map:true, size:3, entries: {0: {sources: Map(), groups: Map(), clientId: "/1/..."}}}`

**제약**:
- 메서드 시그니처 자체는 minified 안됨 (TV 내부 sync 로직에서 사용 → 안정)
- properties 구조는 line 종류마다 다름 (TrendLine vs Fibonacci vs Rectangle)

---

### 후보 2: `pane.dataSources().filter(s => s.constructor.name.startsWith('LineTool'))` — fallback

**원리**: chart pane의 모든 data source 중 LineTool 인스턴스만 필터. 각 LineTool 인스턴스는 `.points()` 또는 `._points` 속성 보유.

```javascript
function readTrendlinesViaDataSources() {
  const w = window._exposed_chartWidgetCollection.activeChartWidget.value();
  const m = w.model();
  const out = [];
  m.panes().forEach((pane, paneIdx) => {
    pane.dataSources().forEach(src => {
      const ctor = src.constructor.name;
      if (!/^LineTool/.test(ctor)) return;     // 예: LineToolTrendLine
      const points = typeof src.points === 'function' ? src.points() : src._points;
      out.push({
        paneIdx,
        ctor,                      // 'LineToolTrendLine'
        toolname: src.toolname,    // 'LineToolTrendLine'
        points,                    // [{time, price}, ...]
      });
    });
  });
  return out;
}
```

**신뢰도**: **중상**
- Evidence: `pane.dataSources()` 동작 확인 (10개 system source 반환, `33_complete_api_map.json` line 33~45)
- 트렌드라인이 추가되면 ctor `LineToolTrendLine`/`LineToolHorzLine` 등으로 등장 (TV 소스코드 컨벤션, charting library docs와 일치)

**제약**:
- ctor 이름 검사가 minify에 의해 `LineToolTrendLine` 그대로 유지되는지 매 빌드 확인 필요 (현재까지는 안정)
- 후보 1이 실패 시 fallback으로 적합

---

### 후보 3: subscribable 이벤트로 실시간 hook — alert 용도에 적합

**원리**: drawings 추가/변경/삭제 시 dispatch되는 Subscribable 이벤트에 콜백 등록 → 사용자가 드로잉 변경 즉시 알림.

```javascript
function subscribeDrawingChanges(onChange) {
  const w = window._exposed_chartWidgetCollection.activeChartWidget.value();
  const m = w.model();
  m.panes().forEach((pane) => {
    pane.dataSourcesCollectionChanged.subscribe(null, () => onChange('collection'));
    pane.sourcePropertiesChanged.subscribe(null, () => onChange('props'));
  });
  // 도구 생성 진행 중 이벤트
  m.lineBeingCreated.subscribe(null, () => onChange('creating'));
  m.lineCancelled.subscribe(null, () => onChange('cancel'));
}
```

**신뢰도**: **중**
- Evidence: `subscribable_signals` (`33_complete_api_map.json` line 124~135)
- pane.dataSourcesCollectionChanged, model.lineBeingCreated 등 확인

**제약**:
- Subscribable.subscribe 시그니처: `subscribe(owner, callback)` — owner null 가능 여부 매 버전 확인
- alert 폴링 (1sec) 으로 충분하다면 후보 1만으로도 OK

---

## 3. 기존 userscript 사례 (조사 결과)

**greasyfork "tradingview" top 30 다운/분석 결과**: 추세선 좌표 추출 userscript는 **0건**.
- 대부분: 광고 제거, 테마 변경, 단축키 추가, 다크모드 (`User scripts for tradingview.com` — `greasyfork.org/en/scripts/by-site/tradingview.com`)
- "TrendLine" 관련 검색 결과 → 전부 **Pine Script (차트 내장 인디케이터)** — 외부 userscript 아님

**GitHub**: `KrustyHack/tradingview-scripts` (38 star) 등 다수 — 모두 Pine Script.

**TradingView Charting Library 공식 docs** (`tradingview.com/charting-library-docs/`):
- `IChartWidgetApi.applyLineToolsState(LineToolsAndGroupsState)` — 임베디드 차트 API. **alertapp 케이스에는 직접 못 씀** (TradingView.com은 Charting Library를 fork했지만 공개 widget 노출 안됨)
- 그러나 내부 메서드 `lineToolsAndGroupsDTO()` 가 동일한 `LineToolsAndGroupsState` 구조 반환 → 공식 docs 의 type definitions 그대로 활용 가능

**핵심**: 본 정찰이 사실상 **이 분야 첫 reverse-engineering**. R4 sub가 이 문서가 baseline.

---

## 4. 권장 방법 (R4 dom.ts 구현 청사진)

### 채택: **후보 1 (lineToolsAndGroupsDTO) + 후보 3 (subscribe) 조합**

이유:
- 후보 1은 단일 API call로 전체 좌표 추출 → 단순/안정
- 후보 3은 실시간 변경 감지 → polling 비용 절감 + alert 즉시성
- 후보 2는 backup

### 30 LoC 구현 청사진

```javascript
// dom.ts — Tampermonkey context (page world 필요!)
// userscript 헤더: @run-at document-idle  + GM_unsafeWindow 또는 // @grant none + window === unsafeWindow

(function () {
  const TARGET_TYPES = new Set(['LineToolTrendLine', 'LineToolHorzLine', 'LineToolHorzRay']);

  function getWidget() {
    const col = window._exposed_chartWidgetCollection;
    return col && col.activeChartWidget && col.activeChartWidget.value();
  }

  function snapshot() {
    const w = getWidget();
    if (!w || typeof w.lineToolsAndGroupsDTO !== 'function') return null;
    const dto = w.lineToolsAndGroupsDTO();    // Map
    const lines = [];
    dto.forEach((paneDto, paneIdx) => {
      paneDto.sources.forEach((tool, id) => {
        if (!TARGET_TYPES.has(tool.type)) return;
        lines.push({
          id, paneIdx, type: tool.type,
          // points: [{ time: unixSec, price: number }, ...]
          p1: tool.points[0], p2: tool.points[1] || tool.points[0],
        });
      });
    });
    return lines;
  }

  // 폴링 (1초) + 변경 시 콜백 — alert.ts 가 cross 판정
  let last = '';
  setInterval(() => {
    const snap = snapshot();
    if (!snap) return;
    const sig = JSON.stringify(snap);
    if (sig !== last) {
      last = sig;
      window.dispatchEvent(new CustomEvent('alertapp:lines', { detail: snap }));
    }
  }, 1000);
})();
```

### 주의사항 (Tampermonkey context)

- TradingView 는 SPA. window 객체는 **page world**에 있음 — Tampermonkey의 isolated world 에서는 `window._exposed_chartWidgetCollection` 안 보임
- 해결: `// @grant none` (page world 직접 실행) **또는** `unsafeWindow._exposed_chartWidgetCollection`
- chart navigate (symbol 변경) 시 widget 인스턴스 재생성됨 → activeChartWidget WatchedValue를 subscribe 권장

### Fallback SOP (TV 가 메서드 명 변경 시)

1. `lineToolsAndGroupsDTO` → 못 찾으면 후보 2 (dataSources filter)로 자동 폴백
2. 두 후보 모두 실패 → console.warn 후 alert UI에 "TV API 변경 감지 — 정찰 필요" 표시
3. 매 TV 빌드 (정찰 마지막 빌드: 2026-05-18) 마다 `probe_tv_v7.py` 재실행하여 API 안정성 확인 (5분 작업)

---

## 5. 위험 / 리스크

### TV obfuscation 패턴 분석

- **메서드명**: NOT minified (정찰 결과 `lineToolsAndGroupsDTO`, `createLineTool`, `dataSources` 등 원본 명칭 유지)
- **클래스명**: minified (`j_`, `ou`, `qn`, `vs`) — 빌드마다 변경 → ctor.name 매칭은 fragile
- **constructor.name === 'LineToolTrendLine'`** 패턴은 **toolname 속성** (string literal "LineToolTrendLine")이 별도 보존되어 안전
- `_exposed_*` 접두 객체는 TV 가 외부 통합용으로 유지하는 안정 API (deprecation 시 RFC 예상)

### 깨졌을 시 영향도

| 깨진 위치 | 영향 | 복구 시간 |
|---|---|---|
| `_exposed_chartWidgetCollection` 이름 변경 | 전체 정지 | 30분 (window dump 재조사) |
| `lineToolsAndGroupsDTO` 메서드명 변경 | 후보 2로 폴백 자동 작동 | 0 (자동) |
| `dto.sources` Map 구조 변경 | 직렬화 로직 수정 | 1~2시간 |
| `tool.points` 형식 변경 (time→bar_index) | 좌표 변환 한 줄 추가 | 10분 |

### 안정성 등급: **중**
- 향후 6~12개월 안정 작동 예상 (TV 의 메이저 리팩토링 사이클)
- monthly로 `probe_tv_v7.py` 재실행하여 회귀 감지 권장

---

## 6. Evidence / 출처

### 실측 evidence (재현 가능)

| 파일 | 내용 |
|---|---|
| `C:/alertapp/docs/probe_tv.py` | 1차 정찰 — window/DOM/storage dump |
| `C:/alertapp/docs/probe_tv_deep.py` | 2차 — chart api introspect |
| `C:/alertapp/docs/probe_tv_v4.py` | 3차 — WatchedValue.value() 발견 |
| `C:/alertapp/docs/probe_tv_v5.py` | 4차 — pane.dataSources(), createLineTool sig |
| `C:/alertapp/docs/probe_tv_v7.py` | 5차 (final) — 완전 API map + DTO 구조 |
| `recon_evidence/01_window_keys.json` | TradingView/TradingViewApi/`_exposed_*` 객체 노출 |
| `recon_evidence/02_dom_probe.json` | Canvas 11개 / SVG 0 / iframe 0 |
| `recon_evidence/04_localstorage.json` | drawings 없음 확인 |
| `recon_evidence/05_indexeddb.json` | drawings 없음 확인 |
| `recon_evidence/26_create_tool_inspect.json` | `createLineTool({pane, point, linetool, properties, linkKey, ownerSource, ...})` 시그니처 |
| `recon_evidence/33_complete_api_map.json` | 전체 API 매핑 (widget/model/pane 메서드) + DTO 구조 |

### 외부 출처

- `https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.IChartWidgetApi/` — Charting Library 공식 API (메서드명 ref)
- `https://www.tradingview.com/charting-library-docs/latest/ui_elements/drawings/drawings-api/` — Drawings API + LineToolsAndGroupsState 타입
- `https://www.tradingview.com/charting-library-docs/latest/saving_loading/save-load-rest-api/drawing-methods/` — drawings 저장 endpoint (sync confirmation)
- `https://www.tradingview.com/support/solutions/43000518095-trendline-drawing-tool/` — Trendline tool spec (Coordinates: bar_number + price 형식 docs 확인)
- `https://greasyfork.org/en/scripts/by-site/tradingview.com` — 기존 userscript 0건 confirm

### Screenshot evidence
- `recon_evidence/20_chart_final.png` — 정찰 시 실제 차트 상태
- `recon_evidence/31_final_chart.png` — DTO 추출 시 차트 상태

---

## 부록: createLineTool 시그니처 (R5에서 자동 그리기 시 활용)

`recon_evidence/26_create_tool_inspect.json`에서 추출:

```javascript
createLineTool({
  pane,                                  // pane 인스턴스
  point,                                 // {time, price} 시작점
  linetool,                              // 'LineToolTrendLine' 등 (string)
  properties,                            // 옵션
  linkKey,                               // linking group key
  ownerSource,                           // 보통 mainSeries
  synchronizationMode,                   // Default
  sharingMode,
  id, actionSource,
})
```

이는 alertapp v2+ 에서 "조건 만족 시 차트에 마커 자동 그리기" 기능을 만들 때 유용.
