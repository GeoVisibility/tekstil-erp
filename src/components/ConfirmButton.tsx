"use client";

/** Gönderilmeden önce onay isteyen submit butonu. */
export function ConfirmButton({
  message,
  className = "btn btn-xs text-red-600",
  children,
  form,
}: {
  message: string;
  className?: string;
  children: React.ReactNode;
  form?: string;
}) {
  return (
    <button
      form={form}
      className={className}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
