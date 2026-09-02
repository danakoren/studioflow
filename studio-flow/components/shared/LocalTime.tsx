/**
 * components/shared/LocalTime.tsx
 *
 * SERVER COMPONENT. Renders a UTC instant in the STUDIO's timezone.
 *
 * Rendering on the server is the point. If the browser formatted the time, a
 * student travelling — or simply with a misconfigured device clock — would see
 * a different hour than the class actually runs at. The studio's timezone is
 * the truth, not the viewer's (test DB-39).
 *
 * <time dateTime={...}> keeps the machine-readable instant in the markup for
 * assistive technology and for copy-paste into a calendar.
 */

import { formatDateTime, formatTime } from '@/lib/time/tz';

export function LocalTime({
  iso,
  timeZone,
  mode = 'time',
  className,
}: {
  iso: string;
  timeZone: string;
  mode?: 'time' | 'datetime';
  className?: string;
}) {
  const label = mode === 'time' ? formatTime(iso, timeZone) : formatDateTime(iso, timeZone);
  return (
    <time dateTime={iso} className={className}>
      {label}
    </time>
  );
}
