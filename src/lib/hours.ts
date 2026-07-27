import { parseCloseHm, parseHm } from './time';
import type { MinuteOfDay, OpenInterval, Weekday, WeeklyHours } from './types';

const CLOSED: readonly OpenInterval[] = [];

export interface WeeklyHoursOptions {
  /** 정기 휴무 요일. */
  readonly closedOn?: readonly Weekday[];
  /** 요일별 예외 영업시간. ['11:00', '15:00'] 형태를 여러 구간 줄 수 있다. */
  readonly overrides?: Readonly<Partial<Record<Weekday, readonly (readonly [string, string])[]>>>;
}

/**
 * 매일 같은 영업시간을 기본으로 두고 휴무·예외만 얹는다.
 * 자정을 넘겨 영업하는 곳은 표현하지 않는다 — 이 MVP의 시연 시간대(낮)에는 필요 없고,
 * 넘기려면 다음 날 구간을 따로 넣어야 해서 판정이 복잡해진다.
 */
export function weeklyHours(
  open: string,
  close: string,
  options: WeeklyHoursOptions = {},
): WeeklyHours {
  const base: OpenInterval = { open: parseHm(open), close: parseCloseHm(close) };
  if (base.close <= base.open) {
    throw new Error(`close must be after open: ${open}-${close}`);
  }

  const closedOn = new Set(options.closedOn ?? []);
  const days: (readonly OpenInterval[])[] = [];
  for (let day = 0; day < 7; day += 1) {
    const weekday = day as Weekday;
    const override = options.overrides?.[weekday];
    if (override) {
      days.push(override.map(([from, to]) => ({ open: parseHm(from), close: parseCloseHm(to) })));
    } else if (closedOn.has(weekday)) {
      days.push(CLOSED);
    } else {
      days.push([base]);
    }
  }
  return days;
}

/** 하루 종일 열려 있는 해변·산책로 같은 곳. */
export function alwaysOpen(): WeeklyHours {
  return weeklyHours('00:00', '24:00');
}

export function intervalsAt(hours: WeeklyHours, weekday: Weekday): readonly OpenInterval[] {
  return hours[weekday] ?? CLOSED;
}

/** 그 시각에 열려 있는 구간. 닫혀 있으면 null. */
export function openIntervalAt(
  hours: WeeklyHours,
  weekday: Weekday,
  minute: MinuteOfDay,
): OpenInterval | null {
  for (const interval of intervalsAt(hours, weekday)) {
    if (minute >= interval.open && minute < interval.close) return interval;
  }
  return null;
}

/** 그 시각 이후로 이용할 수 있는 가장 이른 구간. 그날 더 이상 없으면 null. */
export function nextIntervalFrom(
  hours: WeeklyHours,
  weekday: Weekday,
  minute: MinuteOfDay,
): OpenInterval | null {
  let best: OpenInterval | null = null;
  for (const interval of intervalsAt(hours, weekday)) {
    if (interval.close <= minute) continue;
    if (best === null || interval.open < best.open) best = interval;
  }
  return best;
}
