import type { Tone } from "@/lib/labels";

const TONES: Record<Tone, string> = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  red: "bg-red-50 text-red-700 ring-red-200",
};

export function Badge({ tone = "gray", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${value === 100 ? "bg-emerald-500" : "bg-indigo-500"}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs font-medium tabular-nums text-slate-600">%{value}</span>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{children}</div>;
}

type StageState = "done" | "active" | "blocked" | "waiting" | "skip";

const STAGE_STYLES: Record<StageState, string> = {
  done: "bg-emerald-500 text-white border-emerald-500",
  active: "bg-amber-400 text-white border-amber-400",
  blocked: "bg-red-500 text-white border-red-500",
  waiting: "bg-white text-slate-500 border-slate-300",
  skip: "bg-slate-50 text-slate-300 border-dashed border-slate-200",
};

/** Siparişin işlem adımlarını yatay hat olarak gösterir. */
export function StagePipeline({
  stages,
}: {
  stages: { id: string; name: string; state: string; done: number; total: number }[];
}) {
  return (
    <ol className="flex gap-1 overflow-x-auto pb-1">
      {stages.map((s, i) => (
        <li key={s.id} className="flex min-w-[92px] flex-1 flex-col items-center text-center">
          <div className="flex w-full items-center">
            <div className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : "bg-slate-200"}`} />
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${STAGE_STYLES[s.state as StageState]}`}
            >
              {s.state === "done" ? "✓" : i + 1}
            </div>
            <div className={`h-0.5 flex-1 ${i === stages.length - 1 ? "opacity-0" : "bg-slate-200"}`} />
          </div>
          <div className={`mt-1.5 text-xs font-medium ${s.state === "skip" ? "text-slate-300" : "text-slate-700"}`}>{s.name}</div>
          <div className="text-[11px] text-slate-400">{s.total ? `${s.done}/${s.total}` : "—"}</div>
        </li>
      ))}
    </ol>
  );
}
