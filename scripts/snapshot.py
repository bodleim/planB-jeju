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
SOURCES = {
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
