"use client";

import { useActionState, useEffect, useState } from "react";
import type { FormState } from "@/lib/form";

type Props = Omit<React.FormHTMLAttributes<HTMLFormElement>, "action"> & {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: React.ReactNode;
};

/** Hata mesajını sayfa çökmeden, ekranın altında uyarı olarak gösteren form. */
export function ActionForm({ action, children, ...rest }: Props) {
  const [state, formAction] = useActionState(action, {});
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!state.error) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <>
      <form action={formAction} {...rest}>
        {children}
      </form>
      {visible && state.error && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-start gap-3 rounded-lg bg-red-600 px-4 py-3 text-sm text-white shadow-lg"
        >
          <span className="flex-1">{state.error}</span>
          <button type="button" onClick={() => setVisible(false)} className="text-white/80 hover:text-white" aria-label="Kapat">
            ✕
          </button>
        </div>
      )}
    </>
  );
}
