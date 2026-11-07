import type { TaskStatus } from "@prisma/client";
import { setTaskStatus } from "@/app/(app)/orders/actions";

const TRANSITIONS: Record<TaskStatus, { to: TaskStatus; label: string; primary?: boolean }[]> = {
  PENDING: [
    { to: "IN_PROGRESS", label: "Başlat", primary: true },
    { to: "DONE", label: "Tamamla" },
  ],
  IN_PROGRESS: [
    { to: "DONE", label: "Tamamla", primary: true },
    { to: "BLOCKED", label: "Engel bildir" },
  ],
  BLOCKED: [{ to: "IN_PROGRESS", label: "Devam et", primary: true }],
  DONE: [{ to: "IN_PROGRESS", label: "Geri al" }],
};

export function TaskStatusButtons({ taskId, status }: { taskId: string; status: TaskStatus }) {
  return (
    <div className="flex flex-wrap gap-1">
      {TRANSITIONS[status].map((t) => (
        <form key={t.to} action={setTaskStatus}>
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="status" value={t.to} />
          <button className={`${t.primary ? "btn-primary" : "btn"} btn-xs`}>{t.label}</button>
        </form>
      ))}
    </div>
  );
}
