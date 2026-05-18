# alertapp 설치 상세 가이드

수강생 전용 설치 가이드. README 4단계를 더 자세하게 설명합니다.

---

## 시스템 요구사항

| 항목 | 요구사항 |
|---|---|
| 브라우저 | Chrome / Brave / Edge / Whale (Chromium 계열) |
| Tampermonkey | v5.0 이상 |
| TradingView | 무료 계정 이상 (tradingview.com) |
| Telegram | 계정 보유 (봇 생성 무료) |
| 인터넷 | Binance WebSocket + Telegram API 접근 가능 |

---

## 1단계. Tampermonkey 설치

### Chrome / Brave / Whale

1. [Chrome 웹스토어 링크](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) 접속
2. **"Chrome에 추가"** 클릭
3. **"확장 프로그램 추가"** 팝업 → 확인

설치 후 Chrome 우상단에 Tampermonkey 아이콘(짙은 회색 원)이 나타납니다.

### Edge

1. Edge 메뉴 → 확장 → Microsoft Store 열기 → `Tampermonkey` 검색
2. 또는 Chrome 웹스토어를 Edge 에서 직접 접속 (Edge 는 Chrome 확장 허용)

### 트러블슈팅: "Tampermonkey 아이콘이 안 보임"

- Chrome 우상단 퍼즐 조각 아이콘 클릭 → Tampermonkey 찾기 → 핀 아이콘 클릭해서 고정

---

## 2단계. alertapp userscript 설치

### 자동 설치 (권장)

1. 아래 링크를 **Chrome 새 탭**에서 열기:
   ```
   https://github.com/junsu0505-art/alertapp/releases/latest/download/alertapp.user.js
   ```
2. Tampermonkey 자동 install 화면 팝업
3. **"설치"** 버튼 클릭

### 트러블슈팅: "자동 install 화면이 안 뜸"

Tampermonkey 설정에서 자동 설치가 꺼져 있을 수 있습니다.

**수동 설치 방법:**
1. `alertapp.user.js` 파일을 다운로드
2. Tampermonkey 아이콘 클릭 → **"새 스크립트 추가"**
3. 다운로드한 파일 내용을 전체 복사 → 에디터에 붙여넣기
4. Ctrl+S 저장

### 트러블슈팅: "TradingView 열었는데 🔔 위젯이 안 보임"

1. TradingView 탭을 **완전히 새로고침** (Ctrl+Shift+R 강력 새로고침)
2. URL 확인: `https://www.tradingview.com/chart/...` 형태여야 함
3. Tampermonkey 아이콘 클릭 → alertapp 스크립트 **활성화** 상태인지 확인

---

## 3단계. Telegram bot 1회 등록

### 3-1. BotFather로 봇 생성

1. Telegram 앱 열기 → 검색창에 `@BotFather` 입력 → **BotFather 선택**
2. `/newbot` 전송
3. 봇 표시 이름 입력 (예: `내 알람봇`)
4. 봇 username 입력 (영어, 마지막에 `bot` 필수, 예: `myalert_bot`)
5. BotFather 가 발급한 **token** 복사 (형식: `숫자:문자열`)

> token 은 외부에 노출하지 마세요. alertapp 에만 입력합니다.

### 3-2. chat id 확인

1. 방금 만든 봇과 1:1 대화 시작 (봇 username 검색 → **"시작"** 버튼)
2. 아무 메시지나 1번 전송 (예: `안녕`)
3. 브라우저 주소창에 아래 URL 입력 (`TOKEN` 자리에 본인 token):
   ```
   https://api.telegram.org/botTOKEN/getUpdates
   ```
   예시:
   ```
   https://api.telegram.org/bot7123456789:AABBcc.../getUpdates
   ```
4. JSON 결과에서 `"chat":{"id":` 뒤 숫자 복사

### 트러블슈팅: "getUpdates 응답이 `result:[]` 로 비어 있음"

- 봇에게 메시지를 **먼저 보낸 후** getUpdates 를 호출해야 합니다
- 새 탭에서 봇 링크: `https://t.me/봇username` → 시작 → 메시지 전송 → 다시 getUpdates

### 3-3. alertapp 에 입력

1. TradingView 차트에서 🔔 위젯 클릭
2. **Telegram 설정** 탭 선택
3. **Bot Token** 필드에 token 입력
4. **Chat ID** 필드에 chat id 입력 (숫자만)
5. **저장** 클릭
6. **테스트 전송** 버튼 클릭 → Telegram 에 테스트 메시지 도착 확인

---

## 4단계. 추세선 그림 → 알람 추가

### 지원 종목

Binance Spot 종목만 v1 지원합니다.

TradingView 에서 종목 변경 시 좌상단 검색창에:
```
BINANCE:BTCUSDT
BINANCE:ETHUSDT
BINANCE:SOLUSDT
```
형식으로 입력하세요. `BINANCE:` 접두어와 `USDT` (Spot) 확인 필수.

> `BINANCE:BTCUSDT.P` (PERP) 는 v1 미지원입니다.

### 추세선 그리기

1. TradingView 좌측 도구바 → **추세선** (Trend Line) 도구 선택
2. 차트에서 두 점 클릭해 추세선 생성

### 알람 등록

1. 🔔 위젯 → **+ Alert 추가**
2. **추세선** 선택 (드롭다운에서 해당 추세선 이름 선택)
3. **방향** 선택:
   - **위로 cross**: 가격이 추세선을 아래에서 위로 돌파 시 알림
   - **아래로 cross**: 가격이 추세선을 위에서 아래로 이탈 시 알림
4. **추가** 클릭

### 알람 테스트

- 🔔 위젯 → **알람 목록** 탭에서 등록 확인
- 실제 cross 시 Telegram 알림 수신 (TradingView 탭 열린 상태 유지 필요)

---

## 알람이 안 올 때 체크리스트

1. TradingView 탭이 열려 있는지 확인 (탭 닫으면 알람 작동 X)
2. 🔔 위젯 → Telegram 설정 → 저장된 token / chat id 확인
3. 테스트 전송 버튼으로 Telegram 연결 상태 확인
4. 알람 목록에 해당 추세선 알람이 존재하는지 확인
5. 종목이 `BINANCE:XXXX` Spot 형식인지 확인

---

## 업데이트

새 버전 출시 시 Tampermonkey 자동 업데이트 알림이 뜹니다.
또는 [Releases 페이지](https://github.com/junsu0505-art/alertapp/releases)에서 최신 버전 수동 확인 가능.

---

## 문의

[GitHub Issues](https://github.com/junsu0505-art/alertapp/issues)
