# HANDOFF — alertapp v1.0

## 상태: v1 SPRINT COMPLETED (2026-05-18 ~ 2026-05-19)

## 결과 수치

| 항목 | 수치 |
|---|---|
| 회차 | 8/8 완료 (R0~R7) |
| vitest | 65/65 pass |
| typecheck | 0 error |
| dist dev 빌드 | ~158 KB (sourcemap inline) |
| dist prod 빌드 | ~21 KB (minify, sourcemap 없음) |
| src LoC | 1,886 LoC |
| tests LoC | 1,544 LoC |
| docs LoC | 329 (TV-DOM-recon) + 131 (README) + 167 (INSTALL) = 627 LoC |
| 외부 production deps | 0 |

## 회차 마감 트래커

- [x] R0 — TradingView DOM 정찰 (search-agent, docs/TV-DOM-recon.md 329줄)
- [x] R1 — setup + types + storage + build (9 파일)
- [x] R2 — Binance WS client (src/data/binance-ws.ts 280 LoC + 8 case)
- [x] R3 — Cross 엔진 (src/engine/trendline.ts 95 LoC + 14 case)
- [x] R4 — TV DOM hook + widget UI (src/tradingview/dom.ts 330 + widget.ts 542 LoC + 23 case)
- [x] R5 — Telegram notifier (src/notify/telegram.ts 146 LoC + 7 case)
- [x] R6 — main entry + GitHub Actions (src/main.ts 193 + runner.ts 151 LoC + 6 case)
- [x] R7 — README + LICENSE + prod build + 회귀 + 인계

## Tom 후속 액션 (5~15분)

### 필수 (배포 전)

1. **GitHub repo 생성 + push**
   ```bash
   cd C:/alertapp
   git init
   git add .
   git commit -m "feat: alertapp v1.0 — TradingView 추세선 Telegram 알람"
   # GitHub에서 junsu0505-art/alertapp 신규 repo 생성 (public)
   git remote add origin https://github.com/junsu0505-art/alertapp.git
   git push -u origin main
   ```

2. **v0.1.0 태그 → GitHub Actions 자동 빌드**
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
   → `.github/workflows/build.yml` 자동 실행 → `dist/alertapp.user.js` 가 Releases 에 자동 첨부

3. **수강생 설치 테스트**
   - 본인 Chrome 에 직접 설치 + TradingView 실 추세선 알람 시연
   - `assets/screenshots/` 폴더 생성 → 스크린샷 4~5장 캡처 (README placeholder 교체)

### 선택 (v1.5 대비)

- Firefox 지원 (v1.5)
- Discord / WebPush 알람 (v1.5)
- PERP / 주식 종목 확장 (v2)

## Tom 결재 박제 (7건)

1. 자산군 = 크립토 (Binance Spot v1)
2. 알람 = Telegram bot
3. 차트 UI = TradingView overlay (자체 차트 X)
4. 사용 모델 = Tom 본인 + 1~2 수강생 셀프 설치
5. 형태 = 신규 repo (Decision-Lab 분리)
6. 배포 = Userscript .user.js + GitHub Releases ($0)
7. 호환 = Mac / Windows / Linux (Chromium 사용 OS 자동)

## SOT

- 프로젝트 코드: `C:/alertapp/`
- HQ shadow: `C:/master/hq/outputs/plans/personal-trendline-alert-20260518/`
- repo (예정): `https://github.com/junsu0505-art/alertapp`
