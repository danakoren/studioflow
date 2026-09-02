/**
 * components/schedule/ClassBlock.tsx
 *
 * SERVER COMPONENT. One class inside a day column of the week grid.
 *
 * ==========================================================================
 * COLOUR IS AN ACCELERATOR, NEVER THE MESSAGE
 * ==========================================================================
 * The tone tints the surface, the border and the spine — but every fact the
 * block conveys is also written in text: the class name, the time, the
 * instructor, the seats. Someone who cannot distinguish two of the hues loses
 * nothing but a shortcut, and the class name beside the colour is the
 * "secondary encoding" the palette's colour-blind margin depends on (see the
 * note in lib/design/class-tone.ts).
 *
 * ==========================================================================
 * WHY THE WHOLE BLOCK IS THE LINK
 * ==========================================================================
 * A large hit target matters more than a tidy one on a grid where blocks are
 * ~150px wide. There is exactly one destination per block, so making the card
 * itself the anchor avoids a nested-interactive tangle and gives keyboard users
 * one stop per class instead of three.
 */

import Link from 'next/link';
import { Clock, User, MapPin } from 'lucide-react';
import { formatTime } from '@/lib/time/tz';
import type { ClassTone } from '@/lib/design/class-tone';

export interface ClassBlockData {
  id: string;
  startsAt: string;
  endsAt: string;
  className: string;
  instructorName: string;
  roomName: string;
  status: 'scheduled' | 'cancelled';
  seatsAvailable: number;
  bookedCount: number;
  capacity: number;
  waitingCount: number;
}

export function ClassBlock({
  session,
  tone,
  timeZone,
  href,
  /** Admin grid shows capacity; the public grid shows seats remaining. */
  variant = 'public',
  /** Dims classes that have already started. */
  isPast = false,
}: {
  session: ClassBlockData;
  tone: ClassTone;
  timeZone: string;
  href: string;
  variant?: 'public' | 'admin';
  isPast?: boolean;
}) {
  const cancelled = session.status === 'cancelled';
  const isFull = session.seatsAvailable <= 0;

  /*
   * A cancelled class drops its tone entirely.
   *
   * Keeping the colour would say "this is a Vinyasa class" louder than "this is
   * not happening", and the second is the only thing that matters to someone
   * scanning the week. Grey plus a strikethrough is unambiguous at a glance.
   */
  const surface = cancelled
    ? 'bg-slate-50 border-slate-200'
    : `${tone.surface} ${tone.border} ${tone.surfaceHover}`;

  const bodyText = cancelled ? 'text-slate-500' : tone.text;
  const metaText = cancelled ? 'text-slate-400' : tone.textMuted;

  return (
    <Link
      href={href}
      aria-label={`${session.className} at ${formatTime(session.startsAt, timeZone)}${
        cancelled ? ', cancelled' : ''
      }`}
      className={[
        'group relative block overflow-hidden rounded-xl border p-2.5',
        surface,
        // Lift on hover, settle on press — the same tactile language as Card
        // and Button, so the whole product responds the same way.
        'transition-[transform,box-shadow,background-color] duration-200',
        'ease-[var(--ease-out-soft)]',
        'hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:shadow-sm',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        // Past classes recede rather than disappear: still readable, clearly
        // behind you.
        isPast && !cancelled ? 'opacity-55' : '',
      ].join(' ')}
    >
      {/* The spine. Decorative — it repeats the tint, and every fact it hints
          at is written below. */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1 ${
          cancelled ? 'bg-slate-300' : tone.accent
        }`}
      />

      <div className="pl-2">
        <div className="flex items-baseline justify-between gap-1.5">
          <time
            dateTime={session.startsAt}
            className={`text-sm font-semibold tabular-nums ${bodyText}`}
          >
            {formatTime(session.startsAt, timeZone)}
          </time>

          {!cancelled && variant === 'public' && isFull ? (
            <span className={`text-[11px] font-medium ${metaText}`}>Full</span>
          ) : null}
          {!cancelled && variant === 'admin' ? (
            <span className={`text-[11px] font-medium tabular-nums ${metaText}`}>
              {session.bookedCount}/{session.capacity}
            </span>
          ) : null}
        </div>

        <p
          className={[
            'mt-0.5 text-sm font-medium leading-snug',
            bodyText,
            cancelled ? 'line-through decoration-slate-400' : '',
          ].join(' ')}
        >
          {session.className}
        </p>

        {/* Metadata collapses progressively: the room is the first thing to go
            when a column is narrow, because a student picks a class by time and
            teacher, not by room. */}
        <p className={`mt-1 flex items-center gap-1 text-[11px] ${metaText}`}>
          <User className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{session.instructorName}</span>
        </p>
        <p
          className={`mt-0.5 hidden items-center gap-1 text-[11px] xl:flex ${metaText}`}
        >
          <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{session.roomName}</span>
        </p>

        {cancelled ? (
          <p className="mt-1.5 text-[11px] font-medium text-slate-500">
            Cancelled
          </p>
        ) : (
          <p
            className={`mt-1.5 flex items-center gap-1 text-[11px] font-medium ${metaText}`}
          >
            <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
            {variant === 'public'
              ? isFull
                ? session.waitingCount > 0
                  ? `${session.waitingCount} waiting`
                  : 'Join the waitlist'
                : `${session.seatsAvailable} ${
                    session.seatsAvailable === 1 ? 'place' : 'places'
                  } left`
              : session.waitingCount > 0
                ? `${session.waitingCount} waiting`
                : `${session.seatsAvailable} free`}
          </p>
        )}
      </div>
    </Link>
  );
}
