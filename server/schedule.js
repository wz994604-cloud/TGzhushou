const DAY = 86_400_000;
const OFFSET = 8 * 3_600_000;

function hhmm(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) throw new Error('时间应为 HH:mm');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

export function normalizeSchedule(value) {
  const kind = value?.kind || 'MANUAL';
  if (kind === 'MANUAL') return { kind };
  if (kind === 'ONCE') {
    const at = Number(value.at);
    if (!Number.isSafeInteger(at) || at <= Date.now() - 60_000) throw new Error('指定发布时间已过期');
    return { kind, at };
  }
  if (kind !== 'DAILY') throw new Error('发布方式无效');
  const start = hhmm(value.start), end = hhmm(value.end), interval = Number(value.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 1440) throw new Error('间隔应为 1–1440 分钟');
  if (start === end) throw new Error('每日时段起止时间不能相同');
  return { kind, start: value.start, end: value.end, interval };
}

export function nextSlot(schedule, atOrAfter) {
  if (schedule.kind === 'MANUAL') return null;
  if (schedule.kind === 'ONCE') return schedule.at >= atOrAfter ? schedule.at : null;
  const startMin = hhmm(schedule.start), endMin = hhmm(schedule.end), interval = schedule.interval;
  const localDay = Math.floor((atOrAfter + OFFSET) / DAY);
  for (let day = localDay - 1; day <= localDay + 1; day++) {
    const startAt = day * DAY - OFFSET + startMin * 60_000;
    const windowMinutes = endMin > startMin ? endMin - startMin : 1440 - startMin + endMin;
    const firstIndex = Math.max(0, Math.ceil((atOrAfter - startAt) / (interval * 60_000)));
    const slot = startAt + firstIndex * interval * 60_000;
    if (firstIndex * interval <= windowMinutes && slot >= atOrAfter) return slot;
  }
  return null;
}
