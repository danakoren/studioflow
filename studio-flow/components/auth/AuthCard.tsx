/**
 * components/auth/AuthCard.tsx
 *
 * SERVER COMPONENT. The shared shell for /login and
 * /change-password — narrow, centred, and identical across the three so that
 * moving between them does not shift the form under the user's cursor.
 *
 * max-w-sm rather than the max-w-5xl the root layout uses for content: a login
 * form stretched across a desktop viewport puts the label at one end of the
 * screen and the input at the other.
 */

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-sm py-4 sm:py-8">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <header className="mb-5">
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-slate-600">{description}</p>
          ) : null}
        </header>

        {children}
      </div>
    </div>
  );
}
