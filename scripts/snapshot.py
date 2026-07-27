"""비짓제주·제주 ITS 스냅샷 수집 → src/lib/data/snapshots/*.json

CLAUDE.md 데이터 전략: 이 둘은 앱에서 실시간 호출하지 않고 커밋된 JSON 을 쓴다.
키 승인 지연이나 응답 장애로 시연이 죽는 걸 막는 게 목적이다.
수집 시각(fetchedAt)을 파일 안에 함께 남기고, 화면의 '데이터 기준시각' 에 그대로 쓴다.

    python3 scripts/snapshot.py                # 키 있는 것만 수집
    python3 scripts/snapshot.py visitjeju      # 특정 항목만

수집된 JSON 은 저장소에 커밋한다 (스냅샷이라고 숨기지 말고 기준시각을 표시하면 된다).
"""
import json
import os
import sys
from datetime import datetime

import apis

OUT = os.path.join(apis.ROOT, "src", "lib", "data", "snapshots")

# ponytail: 응답을 원형 그대로 저장한다. 실제 스키마를 확인하기 전에 파서를 쓰면
#           틀린 파서가 남는다. 성산권 필터·필드 정규화는 TS 로더에서 처리할 것.

# 제주 전역 수집. 특정 지점 반경이 아니라 areaCode=39 전체를 받는다 —
# 서비스가 성산권에서만 도는 건 시연이고, 제주 어디서 열어도 후보가 나와야 기능이다.
#
# 목록은 유형별 페이지네이션이라 싸다(유형당 1~6회). 비싼 건 detailIntro2 로,
# **장소 1곳당 1회**다. 제주 전역이 약 1,016곳이라 개발계정(1,000건/일)으로는 이틀 걸린다.
# 그래서 이 수집기는 **재개 가능**하다 — 이미 상세를 받은 곳은 건너뛰고, 예산만큼만 더 받는다.
#
#   python3 scripts/snapshot.py tour-jeju              # 남은 것 전부 시도
#   TOUR_BUDGET=600 python3 scripts/snapshot.py tour-jeju   # 상세 호출 600회만
#
# 목록에서 사라진 장소는 스냅샷에서도 지운다(폐업 등). 상세 캐시는 id 기준으로 살린다.
TOUR_AREA = 39  # 제주특별자치도
LIST_ROWS = 100
DEFAULT_BUDGET = 1000


def _existing(name):
    """이전 스냅샷을 contentid → item 으로. 없으면 빈 dict."""
    path = os.path.join(OUT, f"{name}.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    return {str(it["contentid"]): it for it in payload.get("data", []) if it.get("contentid")}


def tour_jeju():
    """제주 전역 후보 + 운영정보. 상세는 예산 안에서 재개 수집한다."""
    budget = int(os.environ.get("TOUR_BUDGET") or DEFAULT_BUDGET)
    # 성산권 스냅샷을 먼저 만들었다면 그 상세를 물려받는다 (같은 contentid 체계다).
    cache = {**_existing("tour-seongsan"), **_existing("tour-jeju")}

    listed = {}
    for content_type, label in apis.TOUR_TYPES.items():
        page, total = 1, None
        while total is None or len(
            [k for k, v in listed.items() if str(v["contenttypeid"]) == str(content_type)]
        ) < total:
            res = apis.tour_area(content_type=content_type, area=TOUR_AREA, rows=LIST_ROWS, page=page)
            total = apis.tour_total(res)
            items = apis.tour_items(res)
            if not items:
                break
            for it in items:
                listed[str(it["contentid"])] = it
            page += 1
        got = len([v for v in listed.values() if str(v["contenttypeid"]) == str(content_type)])
        print(f"      목록 {content_type} {label:<6} {got}/{total}곳")

    need = [cid for cid in listed if not (cache.get(cid) or {}).get("intro")]
    print(f"      상세: 전체 {len(listed)}곳 중 {len(listed) - len(need)}곳 캐시 보유, {len(need)}곳 필요")
    if len(need) > budget:
        print(f"      예산 {budget}회로 {budget}곳만 받는다. 나머지 {len(need) - budget}곳은 다시 실행하면 이어서 받는다.")

    out, fetched, failed = [], 0, 0
    for cid, item in listed.items():
        intro = (cache.get(cid) or {}).get("intro")
        if intro is None and fetched < budget and cid in set(need):
            try:
                got = apis.tour_items(apis.tour_intro(cid, item["contenttypeid"]))
                intro = got[0] if got else None
                fetched += 1
            except Exception as e:  # noqa: BLE001 - 한 곳의 상세 실패가 수집 전체를 막지 않는다
                failed += 1
                if failed <= 5:
                    print(f"      intro 실패 {item.get('title')}: {type(e).__name__}: {e}")
                if failed > 40:
                    print("      intro 실패가 40회를 넘어 상세 수집을 멈춘다 (쿼터 소진 의심)")
                    budget = fetched
        out.append({**item, "intro": intro})
    have = sum(1 for it in out if it.get("intro"))
    print(f"      상세 확보 {have}/{len(out)}곳 (이번에 {fetched}회 호출, 실패 {failed})")
    return out


SOURCES = {
    "tour-jeju": ("DATA_GO_KR_KEY", "한국관광공사_국문 관광정보 서비스_GW (15101578) / areaBasedList2 + detailIntro2, areaCode 39", tour_jeju),
    # 비짓제주는 페이지네이션 — c1 관광지 위주로 몇 페이지만. 성산권 필터는 로더에서.
    "visitjeju": ("VISITJEJU_KEY", "비짓제주 관광정보", lambda: [apis.visitjeju(category="c1", page=p) for p in (1, 2, 3)]),
    "jeju-traffic": ("JEJU_ITS_KEY", "제주 ITS 실시간 교통정보", apis.jeju_traffic),
    "jeju-road-events": ("JEJU_ITS_KEY", "제주 ITS 돌발상황", apis.jeju_road_events),
}


def collect(names):
    os.makedirs(OUT, exist_ok=True)
    fails = 0
    for name in names:
        env, label, fn = SOURCES[name]
        if not os.environ.get(env):
            print(f"  --  {name:<18} 키없음 ({env})")
            continue
        try:
            data = fn()
        except Exception as e:  # noqa: BLE001 - 한 항목 실패가 나머지를 막지 않는다
            fails += 1
            print(f"  !!  {name:<18} {type(e).__name__}: {e}")
            continue
        path = os.path.join(OUT, f"{name}.json")
        payload = {
            "source": label,
            "fetchedAt": datetime.now(apis.KST).isoformat(timespec="seconds"),
            "data": data,
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)
        print(f"  OK  {name:<18} {os.path.getsize(path) // 1024}KB → {os.path.relpath(path, apis.ROOT)}")
    return fails


if __name__ == "__main__":
    picked = sys.argv[1:] or list(SOURCES)
    unknown = [n for n in picked if n not in SOURCES]
    if unknown:
        sys.exit(f"알 수 없는 항목: {unknown}. 가능한 값: {list(SOURCES)}")
    sys.exit(1 if collect(picked) else 0)
