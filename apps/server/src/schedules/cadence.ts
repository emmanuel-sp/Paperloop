import type { ScheduleConfig } from '@paperloop/contracts';

// Iterate UTC minutes to handle missing/repeated wall-clock times without assuming
// a fixed UTC offset. At most eight days are examined for the supported cadences.
export function occurrence(
  config: ScheduleConfig,
  from: Date,
  direction: 1 | -1,
): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let time = Math.floor(from.getTime() / 60000) * 60000;
  if (direction === 1) time += 60000;
  for (let index = 0; index < 8 * 1440; index++, time += direction * 60000) {
    const parts = Object.fromEntries(
      formatter.formatToParts(time).map((part) => [part.type, part.value]),
    );
    if (
      Number(parts.hour) === config.hour &&
      Number(parts.minute) === config.minute &&
      (config.cadence === 'daily' ||
        parts.weekday === weekdays[config.weekday]) &&
      formatter.format(time) !== formatter.format(time - 3600000) &&
      formatter.format(time) !== formatter.format(time - 7200000)
    )
      return new Date(time).toISOString();
  }
  throw new Error('No occurrence found in eight days.');
}
