"""플랜B 제주 - 외부 API 클라이언트 (스냅샷 수집 + 연결 점검용).

앱 런타임에서 실시간으로 쓰는 건 기상청뿐이고 그건 src/lib/data/weather.ts 에 있다.
이 파일은 키 발급 확인과 비짓제주·교통 스냅샷 수집(scripts/snapshot.py)에서만 쓴다.

    python3 scripts/apis.py     # self-test + 전체 연결 점검

키는 저장소 루트의 .env.local (없으면 .env) 에서 읽는다. 의존성 없음 (stdlib only).
"""
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# .env 로드 (python-dotenv 대신 4줄). cwd 무관하게 저장소 루트에서 읽는다.
for _f in (".env.local", ".env"):
    for line in open(os.path.join(ROOT, _f), encoding="utf-8").read().splitlines() if os.path.exists(os.path.join(ROOT, _f)) else []:
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))

_SSL = ssl.create_default_context()
_SSL.check_hostname = False
_SSL.verify_mode = ssl.CERT_NONE  # ponytail: 일부 공공기관 서버 인증서 체인이 깨져있음. 운영에선 CERT_REQUIRED + certifi


def _get(url, headers=None, **params):
    """GET → dict(JSON) 또는 str. 실패 시 예외."""
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None}, safe="")
    req = urllib.request.Request(f"{url}?{q}" if q else url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=15, context=_SSL) as r:
        body = r.read().decode("utf-8", "replace")
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return body


def _key(name):
    v = os.environ.get(name)
    if not v:
        raise RuntimeError(f"{name} 미설정 (.env 확인)")
    return v


# ---------------------------------------------------------------- 1. 교통 (정체 감지 / 이동시간 보정)
JEJU_ITS = "http://api.jejuits.go.kr/api"


def jeju_traffic():
    """제주 ITS 실시간 교통정보 (교통량·평균속도·점유율·통행시간)."""
    return _get(f"{JEJU_ITS}/getFrafficInfo", code=_key("JEJU_ITS_KEY"))


def jeju_road_events():
    """돌발상황(사고·통제) — 같은 위험 구간 회피용."""
    return _get(f"{JEJU_ITS}/infoRoadEventList", code=_key("JEJU_ITS_KEY"))


# ---------------------------------------------------------------- 2. 관광 후보 장소
def visitjeju(category=None, page=1, locale="kr"):
    """비짓제주 관광정보 (관광지·숙박·음식·문화·행사·체험 + 위치/운영정보).

    category: c1 관광지 / c2 숙박 / c3 쇼핑 / c4 음식 / c5 축제·행사
    """
    return _get(
        "https://api.visitjeju.net/vsjApi/contents/searchList",
        apiKey=_key("VISITJEJU_KEY"), locale=locale, category=category, page=page,
    )


# 비짓제주 대체. 오퍼레이션 이름 끝의 `2` 를 빼면 폐기된 KorService1 이라 404 다.
TOUR = "https://apis.data.go.kr/B551011/KorService2"

# contentTypeId — 후보로 쓸 것만. 32 숙박·15 행사는 대체 일정 대상이 아니라 제외.
TOUR_TYPES = {12: "관광지", 14: "문화시설", 28: "레포츠", 38: "쇼핑", 39: "음식점"}


def _tour(op, **params):
    return _get(f"{TOUR}/{op}", serviceKey=_key("DATA_GO_KR_KEY"),
                MobileOS="ETC", MobileApp="planbjeju", _type="json", **params)


def tour_nearby(lat=33.4744, lon=126.9319, radius=15000, content_type=None, rows=50, page=1):
    """반경 내 관광 후보 (locationBasedList2). 기본 좌표 = 성산항, arrange=E 는 거리순."""
    return _tour("locationBasedList2", mapX=lon, mapY=lat, radius=radius,
                 contentTypeId=content_type, arrange="E", numOfRows=rows, pageNo=page)


def tour_area(content_type=None, area=39, rows=100, page=1):
    """지역 전체 관광 후보 (areaBasedList2). area=39 는 제주도.

    `tour_nearby` 는 반경 기준이라 특정 지점 주변만 나온다. 서비스는 제주 어디서든
    동작해야 하므로 후보 수집은 이쪽을 쓴다. 유형별 총건수는 body.totalCount 에 있다.
    """
    return _tour("areaBasedList2", areaCode=area, contentTypeId=content_type,
                 arrange="A", numOfRows=rows, pageNo=page)


def tour_total(response):
    """응답의 전체 건수. 페이지네이션 종료 조건에 쓴다."""
    return response.get("response", {}).get("body", {}).get("totalCount", 0)


def tour_intro(content_id, content_type):
    """운영시간·휴무일 (detailIntro2). 필드명이 contentTypeId 별로 다르다 —
    12 usetime/restdate, 39 opentimefood/restdatefood, 14 usetimeculture/restdateculture,
    28 usetimeleisure/restdateleisure, 38 opentime/restdateshopping."""
    return _tour("detailIntro2", contentId=content_id, contentTypeId=content_type)


def tour_common(content_id):
    """개요·홈페이지·전화 (detailCommon2). 화면의 '확인 필요' 링크에 쓴다."""
    return _tour("detailCommon2", contentId=content_id)


def tour_items(response):
    """공공데이터 공통 껍데기를 벗긴다. 0건이면 items 가 dict 아닌 빈 문자열로 온다."""
    body = response.get("response", {}).get("body", {})
    items = body.get("items") or {}
    if not isinstance(items, dict):
        return []
    item = items.get("item") or []
    return item if isinstance(item, list) else [item]


# ---------------------------------------------------------------- 3. 날씨 (후보 필터: 강수·강풍·폭염)
KMA = "http://apis.data.go.kr/1360000"


def _kma_base(now=None):
    """단기예보 발표시각 (02,05,08,11,14,17,20,23시 + 10분 지연)."""
    now = (now or datetime.now(KST)) - timedelta(minutes=45)
    h = max([t for t in (2, 5, 8, 11, 14, 17, 20, 23) if t <= now.hour], default=None)
    if h is None:
        now, h = now - timedelta(days=1), 23
    return now.strftime("%Y%m%d"), f"{h:02d}00"


def kma_forecast(nx=52, ny=38, rows=300):
    """기상청 단기예보 (5km 격자, 시간별 기온·강수·풍속). 기본 좌표 = 제주시."""
    d, t = _kma_base()
    return _get(
        f"{KMA}/VilageFcstInfoService_2.0/getVilageFcst",
        serviceKey=_key("DATA_GO_KR_KEY"), dataType="JSON", numOfRows=rows, pageNo=1,
        base_date=d, base_time=t, nx=nx, ny=ny,
    )


def kma_warnings(stn="184"):
    """기상특보 (강풍·풍랑·폭염) — 해상/야외 후보 하드 제외 근거. stn 184 = 제주."""
    today = datetime.now(KST)
    return _get(
        f"{KMA}/WthrWrnInfoService/getWthrWrnList",
        serviceKey=_key("DATA_GO_KR_KEY"), dataType="JSON", numOfRows=20, pageNo=1,
        stnId=stn, fromTmFc=(today - timedelta(days=2)).strftime("%Y%m%d"),
        toTmFc=today.strftime("%Y%m%d"),
    )


# ---------------------------------------------------------------- 4. 대중교통 (버스 축 일정)
TAGO = "http://apis.data.go.kr/1613000"
JEJU_CITY_CODE = 39010  # 제주시


def bus_arrivals(node_id, city=JEJU_CITY_CODE):
    """정류소별 실시간 버스 도착정보 (국토부 TAGO).

    기획서의 '노선별 버스 이용자'는 연간 파일자료라 실시간 대체 불가 → 이 API로 대체.
    """
    return _get(
        f"{TAGO}/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList",
        serviceKey=_key("DATA_GO_KR_KEY"), _type="json", numOfRows=20, pageNo=1,
        cityCode=city, nodeId=node_id,
    )


def bus_stops_nearby(lat, lon, city=JEJU_CITY_CODE):
    """좌표 기반 주변 정류소 — 도보 한도 안의 버스 접근성 판단."""
    return _get(
        f"{TAGO}/BusSttnInfoInqireService/getCrdntPrxmtSttnList",
        serviceKey=_key("DATA_GO_KR_KEY"), _type="json", numOfRows=30, pageNo=1,
        gpsLati=lat, gpsLong=lon,
    )


# ---------------------------------------------------------------- 5. 경로/이동시간/좌표
def kakao_directions(origin, destination, priority="RECOMMEND"):
    """카카오모빌리티 자동차 길찾기 → 구간별 거리·소요시간 (estimateTravelMinutes 보정 근거).

    origin/destination: "경도,위도" 문자열.
    """
    return _get(
        "https://apis-navi.kakaomobility.com/v1/directions",
        headers={"Authorization": f"KakaoAK {_key('KAKAO_REST_KEY')}"},
        origin=origin, destination=destination, priority=priority,
    )


def kakao_geocode(query):
    """주소·장소명 → 좌표 (비짓제주 데이터 좌표 누락 보정)."""
    return _get(
        "https://dapi.kakao.com/v2/local/search/keyword.json",
        headers={"Authorization": f"KakaoAK {_key('KAKAO_REST_KEY')}"},
        query=query, size=5,
    )


# ---------------------------------------------------------------- 6. 결항 / 혼잡 (2차)
def flight_delays(airport="CJU"):
    """공항 운항현황 (한국공항공사) — 결항 상황 설명용."""
    return _get(
        "http://apis.data.go.kr/B551177/StatusOfPassengerFlightsDSOdp/getPassengerDeparturesDSOdp",
        serviceKey=_key("DATA_GO_KR_KEY"), type="json", numOfRows=30, pageNo=1,
        airport=airport,
    )


def tour_visitors(area="39", year_month=None):
    """한국관광공사 관광지별 방문자 추이 (DataLab) — 혼잡 가능성 역사적 보정. area 39 = 제주."""
    ym = year_month or (datetime.now(KST) - timedelta(days=90)).strftime("%Y%m")
    return _get(
        "http://apis.data.go.kr/B551011/DataLabService/metcoRegnVisitrDDList",
        serviceKey=_key("DATA_GO_KR_KEY"), MobileOS="ETC", MobileApp="planb", _type="json",
        startYmd=f"{ym}01", endYmd=f"{ym}28", areaCd=area,
    )


# ---------------------------------------------------------------- 7. LLM (중단원인 분류 / 설명 생성)
def claude(prompt, model="claude-opus-5", max_tokens=1024):
    """설명 생성 전용. 사실(운영시간·결항)은 공공데이터만 사용 — 여기서 생성 금지."""
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps({
            "model": model, "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }).encode(),
        headers={
            "x-api-key": _key("ANTHROPIC_API_KEY"),
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60, context=_SSL) as r:
        return json.loads(r.read())["content"][0]["text"]


# ---------------------------------------------------------------- 연결 점검
CHECKS = [
    ("제주 ITS 실시간교통", "JEJU_ITS_KEY", jeju_traffic),
    ("제주 ITS 돌발상황", "JEJU_ITS_KEY", jeju_road_events),
    ("비짓제주 관광정보", "VISITJEJU_KEY", lambda: visitjeju(category="c1")),
    ("관광공사 후보목록", "DATA_GO_KR_KEY", lambda: tour_nearby(rows=1)),
    ("관광공사 운영정보", "DATA_GO_KR_KEY", lambda: tour_intro("2800664", 12)),
    ("기상청 단기예보", "DATA_GO_KR_KEY", kma_forecast),
    ("기상청 기상특보", "DATA_GO_KR_KEY", kma_warnings),
    ("버스 주변정류소", "DATA_GO_KR_KEY", lambda: bus_stops_nearby(33.4996, 126.5312)),
    ("카카오 길찾기", "KAKAO_REST_KEY", lambda: kakao_directions("126.5312,33.4996", "126.9271,33.4560")),
    ("카카오 지오코딩", "KAKAO_REST_KEY", lambda: kakao_geocode("성산일출봉")),
    ("공항 운항현황", "DATA_GO_KR_KEY", flight_delays),
    ("관광 방문자추이", "DATA_GO_KR_KEY", tour_visitors),
    ("Claude API", "ANTHROPIC_API_KEY", lambda: claude("ok 라고만 답해")),
]


def check():
    fails = 0
    for name, env, fn in CHECKS:
        if not os.environ.get(env):
            print(f"  --  {name:<20} 키없음 ({env})")
            continue
        try:
            r = fn()
            snippet = json.dumps(r, ensure_ascii=False)[:110] if isinstance(r, (dict, list)) else str(r)[:110]
            print(f"  OK  {name:<20} {snippet}")
        except Exception as e:  # noqa: BLE001 - 점검 스크립트는 전부 잡고 계속
            fails += 1
            print(f"  !!  {name:<20} {type(e).__name__}: {e}")
    return fails


def _self_test():
    """키 없이도 도는 로직 검증."""
    assert _kma_base(datetime(2026, 7, 27, 13, 0, tzinfo=KST)) == ("20260727", "1100")
    assert _kma_base(datetime(2026, 7, 27, 11, 30, tzinfo=KST)) == ("20260727", "0800")  # 45분 지연 미달
    assert _kma_base(datetime(2026, 7, 27, 0, 30, tzinfo=KST)) == ("20260726", "2300")  # 자정 전날 롤백
    try:
        _key("__NOPE__")
        raise AssertionError("missing key must raise")
    except RuntimeError:
        pass
    print("self-test ok")


if __name__ == "__main__":
    _self_test()
    print("\n--- API 연결 점검 ---")
    sys.exit(1 if check() else 0)
