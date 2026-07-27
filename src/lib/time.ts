import type { MinuteOfDay, Weekday } from './types.ts';

export const MINUTES_PER_DAY = 1440;

const HM_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function tryParseHm(value: string): MinuteOfDay | null {
  const matched = HM_PATTERN.exec(value.trim());
  if (!matched) return null;
  return Number(matched[1]) * 60 + Number(matched[2]);
}

export function parseHm(value: string): MinuteOfDay {
  const parsed = tryParseHm(value);
  if (parsed === null) throw new Error(`invalid HH:MM value: ${value}`);
  return parsed;
}

/** 영업 종료 시각 전용. 하루 끝을 뜻하는 '24:00'을 1440으로 받는다. */
export function parseCloseHm(value: string): MinuteOfDay {
  if (value.trim() === '24:00') return MINUTES_PER_DAY;
  return parseHm(value);
}

/**
 * 자정 기준 분을 HH:MM으로. 1440을 넘는 값은 '25:10'처럼 그대로 넘겨 표시한다 —
 * 하루를 넘겼다는 사실을 00:00으로 감추면 일정이 맞는지 눈으로 확인할 수 없다.
 */
export function formatHm(minute: MinuteOfDay): string {
  const total = Math.max(0, Math.round(minute));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** 90 -> '1시간 30분' */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}분`;
  if (rest === 0) return `${hours}시간`;
  return `${hours}시간 ${rest}분`;
}

const JEJU_TIME_ZONE = 'Asia/Seoul';

const WEEKDAY_INDEX: Readonly<Record<string, Weekday>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface JejuClock {
  readonly weekday: Weekday;
  readonly minuteOfDay: MinuteOfDay;
}

/**
 * 제주 현지 시각. Vercel 서버는 UTC로 돌기 때문에 new Date().getHours()를 쓰면
 * 영업시간 판정이 9시간 어긋난다. 시각이 필요한 곳은 전부 이 함수를 통과시킨다.
 */
export function jejuClock(instant: Date = new Date()): JejuClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: JEJU_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  let weekday: Weekday = 0;
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === 'weekday') weekday = WEEKDAY_INDEX[part.value] ?? 0;
    else if (part.type === 'hour') hour = Number(part.value) % 24;
    else if (part.type === 'minute') minute = Number(part.value);
  }

  return { weekday, minuteOfDay: hour * 60 + minute };
}
