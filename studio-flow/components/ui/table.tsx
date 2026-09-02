/**
 * components/ui/table.tsx — Server Components. Layout only.
 *
 * A real <table> with real <th scope>, not a grid of divs. The admin pages show
 * genuinely tabular data — a student list, a fill-rate breakdown — and a screen
 * reader can only announce "row 4, balance 12" if the markup says table.
 *
 * ==========================================================================
 * HORIZONTAL SCROLL IS THE WRAPPER'S JOB
 * ==========================================================================
 * TableWrap owns `overflow-x-auto`, so a wide table scrolls INSIDE its own box
 * instead of making the whole page scroll sideways on a phone. Every admin
 * table is wrapped; that is why these ship as a pair.
 */

import type { ReactNode } from 'react';

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Table({ children }: { children: ReactNode }) {
  return <table className="w-full border-collapse text-sm">{children}</table>;
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-slate-200 bg-slate-50/60">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-slate-100">{children}</tbody>;
}

export function TR({ children }: { children: ReactNode }) {
  return <tr>{children}</tr>;
}

export function TH({
  children,
  align = 'left',
  className = '',
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-3 py-2.5 font-medium text-slate-600 ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  align = 'left',
  className = '',
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2.5 text-slate-900 ${
        align === 'right' ? 'text-right tabular-nums' : 'text-left'
      } ${className}`}
    >
      {children}
    </td>
  );
}
