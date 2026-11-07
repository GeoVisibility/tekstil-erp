"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card card-pad mx-auto mt-10 max-w-lg text-center">
      <h2 className="text-lg font-semibold">Bir şeyler ters gitti</h2>
      <p className="mt-2 text-sm text-slate-500">
        İşlem tamamlanamadı. Tekrar deneyin; sorun sürerse bu kodu iletin:
        {error.digest && <code className="ml-1 rounded bg-slate-100 px-1.5 py-0.5">{error.digest}</code>}
      </p>
      <button onClick={reset} className="btn-primary mt-4">Tekrar dene</button>
    </div>
  );
}
