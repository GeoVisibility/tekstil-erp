"use client";

import { useActionState, useEffect, useRef } from "react";
import { addShipment } from "@/app/(app)/sales/actions";

type Props = { lineId: string; title: string; ordered: number; shipped: number; today: string };

/** Sipariş listesinde satır içinden yükleme girişi: tarih, adet ve "Yüklendi" işareti. */
export function QuickShip({ lineId, title, ordered, shipped, today }: Props) {
  const [state, action, pending] = useActionState(addShipment, {});
  const ref = useRef<HTMLDialogElement>(null);
  const remaining = ordered - shipped;

  useEffect(() => {
    if (state.ok) ref.current?.close();
  }, [state.ok]);

  return (
    <>
      <button type="button" className="btn btn-xs" onClick={() => ref.current?.showModal()}>
        Yükle
      </button>
      <dialog ref={ref} className="m-auto w-80 rounded-xl p-0 shadow-xl backdrop:bg-slate-900/30">
        <form key={state.ok ?? 0} action={action} className="space-y-3 p-4 text-left">
          <div>
            <h3 className="font-semibold">Yükleme gir</h3>
            <p className="text-xs text-slate-500">
              {title} · sipariş {ordered} adet{shipped > 0 ? `, yüklenen ${shipped}` : ""}
            </p>
          </div>
          <input type="hidden" name="lineId" value={lineId} />
          <label className="block text-xs text-slate-600">
            Yükleme tarihi
            <input type="date" name="date" defaultValue={today} className="input-sm mt-0.5 w-full" required />
          </label>
          <label className="block text-xs text-slate-600">
            Yüklenen adet
            <input
              name="quantity"
              type="number"
              min={1}
              defaultValue={remaining > 0 ? remaining : undefined}
              className="input-sm mt-0.5 w-full"
              required
              autoFocus
            />
          </label>
          <input name="note" placeholder="Not (opsiyonel)" className="input-sm w-full" />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="markShipped" defaultChecked />
            &quot;Yüklendi&quot; olarak işaretle
          </label>
          <p className="-mt-2 text-xs text-slate-500">İşareti kaldırırsanız kısmi yükleme olarak kaydedilir, satır açık kalır.</p>
          {state.error && <p className="text-xs text-red-600">{state.error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-xs" onClick={() => ref.current?.close()}>
              Vazgeç
            </button>
            <button className="btn-primary btn-xs" disabled={pending}>
              {pending ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
