# alertapp — TradingView 추세선 알람 (Tampermonkey)

TradingView 차트에 직접 그린 추세선에 가격이 cross 하는 순간 Telegram 알림.
**무료. Mac / Windows / Linux 자동 호환. 서버 불필요. 셀프 설치형.**

> "내가 그린 추세선 건드리면 바로 알려줘" — 비용 $0, PC 의존성 0.

---

## 데모

![데모 스크린샷](assets/screenshots/demo.png)

*TradingView 우상단 🔔 위젯 → 추세선 선택 → cross 방향 설정 → Telegram 알림 수신*

---

## 수강생 4단계 설치 (5분)

### 1단계. Tampermonkey 설치 (Chrome 무료 확장)

1. Chrome 웹스토어 접속 → `"Tampermonkey"` 검색
2. **"Chrome에 추가"** 클릭 → 확장 설치 완료

![Tampermonkey 설치](assets/screenshots/01-tampermonkey.png)

> Brave / Edge / Whale 에서도 동일하게 동작합니다.

---

### 2단계. alertapp userscript 설치

아래 링크를 클릭하면 Tampermonkey 자동 install 화면이 뜹니다.

```
https://github.com/junsu0505-art/alertapp/releases/latest/download/alertapp.user.js
```

**"설치"** 버튼 클릭 → 완료.

![userscript 설치](assets/screenshots/02-install.png)

설치 후 TradingView(tradingview.com)를 열면 우상단에 🔔 아이콘이 나타납니다.

---

### 3단계. Telegram bot 1회 등록

#### 3-1. bot 생성

1. Telegram 앱 → `@BotFather` 검색 → 대화 시작
2. `/newbot` 전송 → 봇 이름 / username 입력 (예: `MyAlertBot`)
3. 발급된 **bot token** 복사 (예: `7123456789:AABBcc...`)

![BotFather](assets/screenshots/03-botfather.png)

#### 3-2. chat id 확인

1. 방금 만든 봇과 대화 시작 → 아무 메시지 1번 전송
2. 브라우저에서 아래 URL 방문 (`<TOKEN>` 자리에 본인 token 붙여넣기):
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
3. JSON 응답 안 `"chat":{"id": 123456789}` 숫자 복사

#### 3-3. alertapp에 등록

TradingView 우상단 🔔 위젯 → **Telegram 설정** 탭 → bot token + chat id 입력 → **저장**

---

### 4단계. 추세선 그림 → 알람 추가

1. TradingView에서 BTC/USDT(Binance Spot) 등 종목 열기
2. 추세선 도구로 차트에 추세선 그리기
3. 우상단 🔔 위젯 → **+ Alert 추가** 클릭
4. 대상 추세선 선택 → 방향 선택 (위로 cross / 아래로 cross) → **추가**

![Alert 추가](assets/screenshots/04-alert.png)

가격이 추세선에 닿는 순간 Telegram 알림이 옵니다.

---

## 알려진 제약 (v1)

| 제약 | 설명 | 해소 예정 |
|---|---|---|
| TradingView 탭 열려 있어야 함 | 트레이딩 중이라면 어차피 열려 있음 | v2 — 백그라운드 서비스 (옵션) |
| Chromium 계열만 | Chrome / Brave / Edge / Whale | v1.5 — Firefox 지원 |
| Binance Spot 종목만 | BTCUSDT, ETHUSDT 등 | v2 — PERP / 주식 확대 |
| Telegram만 | 봇 토큰 1회 발급 필요 | v1.5 — Discord / WebPush 추가 |

---

## 자체 개발 / Fork

```bash
git clone https://github.com/junsu0505-art/alertapp.git
cd alertapp
npm install

npm run test        # vitest 65 case
npm run typecheck   # 0 error
npm run build       # dev 빌드 (sourcemap inline, ~158 KB)
npm run build:prod  # production 빌드 (minify, ~21 KB)
npm run dev         # watch 모드
```

빌드 결과물: `dist/alertapp.user.js`

---

## 안전 / 프라이버시

- Telegram bot token / chat id 는 **본인 PC 의 Tampermonkey 로컬 storage** 에만 저장
- **외부 서버 endpoint 0** — 개발자(Tom) PC 를 전혀 거치지 않음
- Binance WebSocket: **본인 Chrome → Binance 직접 통신**
- Telegram API: **본인 Chrome → api.telegram.org 직접**

---

## 트러블슈팅

자세한 설치 가이드 및 트러블슈팅: [docs/INSTALL.md](docs/INSTALL.md)

---

## License

MIT — [LICENSE](LICENSE)
