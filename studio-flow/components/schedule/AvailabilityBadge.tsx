/**
 * components/schedule/AvailabilityBadge.tsx
 *
 * SERVER COMPONENT.
 *
 * Design §8.3: COLOUR IS NEVER THE SOLE CARRIER OF MEANING. Every state below
 * includes text, so the badge works for a colour-blind user and in a
 * screenshot printed in greyscale. "Full · 3 waiting" is legible without any
 * colour at all.
 *
 * Three states, from Design §8.2:
 *   open  -> green, "6 spots left"
 *   low   -> amber, under 3 remaining
 *   full  -> grey,  "Full · N waiting"
 */

import { Badge } from '@/components/ui/badge';
import { availabilityTone } from '@/lib/domain/policy';

export function AvailabilityBadge({
  seatsAvailable,
  waitingCount,
}: {
  seatsAvailable: number;
  waitingCount: number;
}) {
  const tone = availabilityTone(seatsAvailable);

  if (tone === 'full') {
    return (
      <Badge tone="neutral">
        Full
        {waitingCount > 0 ? ` · ${waitingCount} waiting` : ''}
      </Badge>
    );
  }

  return (
    <Badge tone={tone === 'low' ? 'warning' : 'success'}>
      {seatsAvailable} {seatsAvailable === 1 ? 'spot' : 'spots'} left
    </Badge>
  );
}
