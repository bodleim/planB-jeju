# 플랜B 제주

제주 여행 중 일정이 끊겼을 때 — 배가 결항되고, 비가 오고, 가려던 곳이 문을 닫았을 때 —
현재 위치와 남은 시간에 맞는 대체 일정을 다시 짜주는 웹 앱입니다.

여행 *전* 추천이 아니라 여행 *중* 복구를 다룹니다. 핵심 동작은 세 가지입니다:

- 공공데이터(영업시간·휴무·기상)로 검증된 후보만으로 시간대별 일정을 만들고
- 일정을 깨뜨린 것과 **같은 위험을 가진 후보는 제외**하며 (강풍 결항 → 다른 해상 일정 제외)
- 마음에 안 드는 시간대는 스와이프 한 번으로 바꿉니다

## 특징

- **모든 방문지는 도착 시각에 실제로 열려 있습니다.** 영업시간·휴무일 판정이 단일 함수
  (`tryVisit`)에 모여 있어 생성·교체·재생성 어느 경로로도 이 불변식이 깨지지 않습니다.
- **자연어 입력** — "애 둘이랑 갈 만한 실내로 채워줘", "해산물은 못 먹어" 같은 문장을
  LLM(Gemini)이 구조화된 조건으로 바꿉니다. LLM은 미리 검증된 후보 목록에서 id를
  고를 수만 있고, 운영시간 같은 사실은 생성할 수 없습니다.
- **모든 외부 의존성에 폴백이 있습니다.** 기상 API가 죽으면 중단 원인 기반 판정으로,
  LLM이 죽으면 키워드 파서로, 지도 SDK가 죽으면 SVG 개략도로 내려가며, 폴백 사실을
  화면에 그대로 표시합니다.
- **서버 렌더링 + GET.** 상태가 전부 쿼리스트링에 있어서 JS 없이도 동작하고, 어떤
  화면이든 URL 하나로 재현·공유할 수 있습니다. 클라이언트 JS는 스와이프·위치 감지·지도
  같은 편의 장치뿐입니다.
- **제외 이유를 보여줍니다.** 걸러진 후보를 버리지 않고 "그 요일은 휴무", "남은 시간 안에
  도착 불가" 같은 이유와 함께 화면에 남깁니다.

## 시작하기

Node.js 20+ 가 필요합니다. 스냅샷·API 점검 스크립트는 Python 3(표준 라이브러리만)을 씁니다.

```bash
git clone https://github.com/bodleim/planB-jeju.git
cd planB-jeju
npm install
cp .env.example .env.local   # 아래 표를 보고 키를 채우세요
npm run dev                  # http://localhost:3000
```

### 환경 변수

| 키 | 필수 | 설명 |
|---|---|---|
| `DATA_GO_KR_KEY` | ✅ | [공공데이터포털](https://www.data.go.kr) 키 하나로 기상청 단기예보·관광공사 TourAPI를 커버합니다. **Decoding 키**를 넣어야 합니다 (Encoding 키는 이중 인코딩으로 깨집니다) |
| `NEXT_PUBLIC_KAKAO_JS_KEY` | | 카카오맵. [카카오 개발자 콘솔](https://developers.kakao.com)에서 JavaScript 키의 **[JavaScript SDK 도메인]** 에 사용할 도메인을 등록해야 합니다. 없으면 SVG 개략도로 대체됩니다 |
| `GEMINI_API_KEY` | | 자연어 입력 해석. [Google AI Studio](https://aistudio.google.com/apikey)에서 무료 발급. 없으면 키워드 파서로 대체됩니다 |

세 키 모두 없어도 앱은 뜹니다 — 해당 기능이 폴백으로 동작할 뿐입니다.

### 사용 예

모든 상태는 쿼리스트링입니다. 예를 들어 "성산항에서 10시에 배가 결항됐고, 둘이서 16시
체크인 전까지 실내 위주로"는 URL 한 줄로 표현됩니다:

```
/?go=1&cause=ferry_cancelled&from=성산항&at=10:00&end=16:00&party=2&car=yes&companion=couple&activity=indoor
```

## 스크립트

```bash
npm run dev            # 개발 서버
npm run build          # 프로덕션 빌드 (타입체크 포함)
npm run lint           # ESLint

# 체크 스크립트 — 테스트 러너 없이 node --experimental-strip-types 로 돕니다. 키 불필요.
npm run check:weather  # 기상청 발표시각·파싱·위험판정
npm run check:places   # TourAPI 운영시간·휴무 파서 + 스냅샷 적재
npm run check:filter   # 후보 필터 제약 + 필터→계획 불변식
npm run check:plan     # 계획 생성 + 시간대 교체·재생성
npm run check:prompt   # 자연어 키워드 폴백 파서
npm run check:intent   # LLM 응답 검증 (목록 밖 id·이상값 차단)

npm run check:api      # 보유한 API 키 발급/연결 일괄 점검 (python)
npm run snapshot       # 관광 후보 스냅샷 재수집 → src/lib/data/snapshots/
```

## 동작 원리

```
사용자 입력 (위치·시간·성격·중단 원인·자연어)
        │
        ▼
F3  findCandidates()     기상·결항·환승·영업·거리 5가지 하드 제약으로 후보를 거른다.
    src/lib/filter/      제외된 후보는 이유와 함께 반환한다.
        │
        ▼
F1  generatePlan()       통과한 후보를 시간대별로 배치해 계획 1개를 만들고,
    src/lib/plan/        각 시간대의 나머지 후보를 대안으로 보관한다.
        │
        ▼
F2  swapSlot() 등        스와이프·교체·재생성. 상태는 `pins`(장소 id 목록) 하나이고,
    src/lib/plan/        교체 결과도 F1을 다시 통과하므로 제약이 우회되지 않는다.
```

- **점수는 제약을 통과한 후보들 사이의 순위만 정합니다.** 점수를 올려서 탈락 후보를
  되살릴 수 없습니다.
- **자연어 입력**은 Gemini 구조화 출력(responseSchema)으로 원인·동반·활동·시간을 추출하고,
  후보 목록에서 선호(`prefer`)/회피(`avoid`) id를 고릅니다. 목록 밖 id는 서버 검증이
  버립니다. 회피는 하드 제외, 선호는 점수 보너스로 반영됩니다.

### 데이터

| 데이터 | 방식 |
|---|---|
| 기상 (기상청 단기예보) | 런타임 실시간 호출, 실패 시 폴백 |
| 장소·운영정보 (한국관광공사 TourAPI) | 사전 수집한 JSON 스냅샷을 저장소에 커밋. 수집 시각을 화면에 표시 |
| 여객선 결항 | 안정적 공개 API가 없어 사용자 입력으로 받음 |
| 이동시간 | 거리 기반 추정 (화면에 추정임을 표시) |

## 프로젝트 구조

```
src/
  app/page.tsx            화면 4종 (홈 · 자연어 입력 시트 · 일정 결과 · 시간대 교체 시트)
  app/RouteMap.tsx        카카오맵 동선 (실패 시 투명 → 뒤의 SVG 개략도)
  lib/types.ts            도메인 타입 (Place, TripCategory, …)
  lib/filter/             F3 — 후보 필터
  lib/plan/               F1·F2 — 계획 생성·교체·점수
  lib/data/places.ts      TourAPI 스냅샷 → Place[]
  lib/data/weather.ts     기상청 단기예보 클라이언트
  lib/llm-intent.ts       자연어 해석 (Gemini)
  lib/prompt.ts           자연어 해석 폴백 (키워드 표)
scripts/                  API 점검·스냅샷 수집 (python, 의존성 없음)
```

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4

## 한계와 로드맵

- 후보 범위가 현재 **성산·우도권**(수집 반경 15km)입니다. `scripts/snapshot.py`의
  `tour-jeju`로 제주 전역(약 1,000곳)까지 확장할 수 있습니다.
- 위치 감지와 장소 검색이 둘 다 없으면 성산항을 현재 위치로 간주합니다(데모용 임시 동작,
  `page.tsx`의 origin 계산부 주석 참고).
- 기상특보 API는 승인 대기 상태라 위험 판정에 들어가지 않습니다. 승인되면 코드 수정 없이
  반영됩니다.
- 대중교통 이동시간이 버스 시간표가 아닌 평균 속도 추정입니다. TAGO 정류소 스냅샷을
  추가하면 개선할 수 있습니다.

## 데이터 출처

- 장소·운영정보: [한국관광공사 국문 관광정보 서비스(TourAPI)](https://api.visitkorea.or.kr)
- 기상: [기상청 단기예보 조회서비스](https://www.data.go.kr/data/15000099/openapi.do)
- 지도: [Kakao Maps JavaScript SDK](https://apis.map.kakao.com)

이 프로젝트는 2026 제주 지역대학 연합 창업 캠프에서 팀 '우리 친해요'(현용빈, 박범준,
오채원)가 시작했습니다.
