import { unstable_rethrow } from "next/navigation";

export type FormState = { error?: string; ok?: number };

/**
 * Server action'ı form durumuna çevirir: hata fırlatırsa sayfa çökmez,
 * mesaj forma döner. redirect()/notFound() normal şekilde çalışmaya devam eder.
 */
export async function withFormState(run: () => Promise<unknown>): Promise<FormState> {
  try {
    await run();
    return { ok: Date.now() };
  } catch (e) {
    unstable_rethrow(e);
    if (e && typeof e === "object" && "issues" in e) {
      // zod doğrulama hatası: şemadaki (Türkçe) ilk mesajı göster
      const issues = (e as { issues: { message?: string }[] }).issues;
      return { error: issues[0]?.message || "Form alanlarını kontrol edin." };
    }
    console.error(e);
    return { error: e instanceof Error && e.message ? e.message : "Beklenmeyen bir hata oluştu." };
  }
}
