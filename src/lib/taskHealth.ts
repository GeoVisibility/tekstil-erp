// Görevlerin zamanlama durumu: sipariş listesinde yeşil / alarm göstermek için (sunucu + istemci).
import type { TaskStatus } from "@prisma/client";
import { parseDateInput, type Tone } from "./labels";

const DAY = 86400000;
/** "Yaklaşıyor" uyarısı için kalan gün eşiği */
export const SOON_DAYS = 2;

export type HealthTask = {
  status: TaskStatus;
  dueDate: Date | null;
  completedAt: Date | null;
  process: { id: string; name: string; sortOrder: number };
};

export type StepState = "done" | "doneLate" | "overdue" | "blocked" | "active" | "soon" | "waiting";

/** Tamamlanma anının Türkiye'deki takvim günü (UTC gece yarısı) */
function dayOf(d: Date) {
  return parseDateInput(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(d));
}

export function taskState(t: Omit<HealthTask, "process">, todayTs: number): StepState {
  const due = t.dueDate?.getTime();
  if (t.status === "DONE") {
    return due != null && t.completedAt && dayOf(t.completedAt).getTime() > due ? "doneLate" : "done";
  }
  if (due != null && due < todayTs) return "overdue";
  if (t.status === "BLOCKED") return "blocked";
  if (t.status === "IN_PROGRESS") return "active";
  if (due != null && due - todayTs <= SOON_DAYS * DAY) return "soon";
  return "waiting";
}

// Bir adımda birden çok görev varsa en kötüsü gösterilir
const SEVERITY: StepState[] = ["overdue", "blocked", "soon", "active", "waiting", "doneLate", "done"];

export const STEP_STYLE: Record<StepState, { label: string; dot: string }> = {
  done: { label: "Zamanında tamamlandı", dot: "bg-emerald-500" },
  doneLate: { label: "Gecikmeli tamamlandı", dot: "bg-lime-500" },
  overdue: { label: "Gecikti", dot: "bg-red-500 animate-pulse" },
  blocked: { label: "Engellendi", dot: "bg-red-400" },
  active: { label: "Devam ediyor", dot: "bg-blue-500" },
  soon: { label: "Süresi yaklaşıyor", dot: "bg-amber-400" },
  waiting: { label: "Bekliyor", dot: "bg-slate-300" },
};

export type Health = {
  tone: Tone;
  label: string;
  /** Satırın arka plan vurgusu */
  row: "ok" | "alarm" | null;
  overdue: number;
  steps: { id: string; name: string; state: StepState; dueDate: Date | null }[];
};

/** Görev listesinden sipariş satırının genel durumunu çıkarır. `open`: satır hâlâ açık mı (yüklenmemiş/iptal değil). */
export function taskHealth(tasks: HealthTask[], todayTs: number, open = true): Health | null {
  if (tasks.length === 0) return null;

  const byProcess = new Map<string, { id: string; name: string; sortOrder: number; states: StepState[]; dueDate: Date | null }>();
  for (const t of tasks) {
    const p = byProcess.get(t.process.id) ?? { ...t.process, states: [], dueDate: null };
    p.states.push(taskState(t, todayTs));
    if (t.dueDate && (!p.dueDate || t.dueDate > p.dueDate)) p.dueDate = t.dueDate;
    byProcess.set(t.process.id, p);
  }
  const steps = [...byProcess.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => ({ id: p.id, name: p.name, dueDate: p.dueDate, state: SEVERITY.find((s) => p.states.includes(s))! }));

  const states = tasks.map((t) => taskState(t, todayTs));
  const overdue = states.filter((s) => s === "overdue").length;
  const allDone = states.every((s) => s === "done" || s === "doneLate");
  const current = steps.find((s) => s.state !== "done" && s.state !== "doneLate");

  if (allDone) {
    const late = states.includes("doneLate");
    return { tone: late ? "amber" : "green", label: late ? "Tamamlandı (gecikmeli)" : "Zamanında tamamlandı", row: late ? null : "ok", overdue, steps };
  }
  if (!open) return { tone: "gray", label: current ? `Kapandı · ${current.name} açık` : "Kapandı", row: null, overdue: 0, steps };
  if (overdue) {
    const first = steps.find((s) => s.state === "overdue");
    return { tone: "red", label: `${first?.name ?? "Görev"} gecikti${overdue > 1 ? ` (+${overdue - 1})` : ""}`, row: "alarm", overdue, steps };
  }
  const blocked = steps.find((s) => s.state === "blocked");
  if (blocked) return { tone: "red", label: `${blocked.name} engellendi`, row: "alarm", overdue, steps };
  const soon = steps.find((s) => s.state === "soon");
  if (soon) return { tone: "amber", label: `${soon.name} · süresi yaklaşıyor`, row: null, overdue, steps };
  return { tone: "blue", label: current ? current.name : "Devam ediyor", row: null, overdue, steps };
}
