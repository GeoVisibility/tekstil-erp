import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Badge, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { ORG_TYPE_LABELS } from "@/lib/labels";
import { ROLE_LABELS } from "@/lib/roles";
import { orgScope } from "@/lib/scope";
import { requireRole } from "@/lib/session";
import { userUsage } from "@/lib/usage";
import { deleteUser, toggleUserActive, updateUser } from "../../actions";

export default async function UserEditPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const { id } = await params;
  const orgs = await prisma.organization.findMany({ where: { AND: [orgScope(s), { active: true }] }, orderBy: [{ type: "asc" }, { name: "asc" }] });
  const user = await prisma.user.findFirst({
    where: { id, ...(s.role === "DEVELOPER" ? {} : { organizationId: { in: orgs.map((o) => o.id) } }) },
    include: { organization: { select: { id: true, name: true } } },
  });
  if (!user) notFound();
  const usage = await userUsage(user.id);
  const isSelf = user.id === s.uid;

  return (
    <>
      <PageHeader
        title={user.name}
        subtitle={
          <span className="flex items-center gap-2">
            <Badge tone={user.role === "DEVELOPER" ? "red" : "blue"}>{ROLE_LABELS[user.role]}</Badge>
            {user.organization?.name}
            {!user.active && <Badge tone="red">Pasif</Badge>}
          </span>
        }
        actions={<Link href="/admin/users" className="btn">← Kullanıcılar</Link>}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <ActionForm key={`${user.name}|${user.email}|${user.organizationId}`} action={updateUser} className="card card-pad grid h-fit gap-4 sm:grid-cols-2">
          <input type="hidden" name="id" value={user.id} />
          <div>
            <label className="label">Ad soyad *</label>
            <input name="name" defaultValue={user.name} className="input" required minLength={2} />
          </div>
          <div>
            <label className="label">E-posta *</label>
            <input name="email" type="email" defaultValue={user.email} className="input" required />
          </div>
          <div>
            <label className="label">Organizasyon</label>
            {user.role === "DEVELOPER" || isSelf ? (
              <div className="input bg-slate-50">{user.organization?.name ?? "— (Developer)"}</div>
            ) : (
              <select name="organizationId" defaultValue={user.organizationId ?? ""} className="input">
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name} ({ORG_TYPE_LABELS[o.type]})</option>
                ))}
              </select>
            )}
            <p className="mt-1 text-xs text-slate-500">Yetki, seçilen organizasyonun tipine göre belirlenir.</p>
          </div>
          <div>
            <label className="label">Yeni şifre (değiştirmek için)</label>
            <input name="password" type="password" minLength={8} className="input" autoComplete="new-password" placeholder="Boş bırakılırsa değişmez" />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <button className="btn-primary">Değişiklikleri kaydet</button>
          </div>
        </ActionForm>

        {!isSelf && (
          <section className="card card-pad h-fit space-y-3">
            <h2 className="text-sm font-semibold">Pasif yap / sil</h2>
            <p className="text-xs text-slate-500">Pasif kullanıcı giriş yapamaz; geçmiş kayıtları korunur.</p>
            <ActionForm action={toggleUserActive}>
              <input type="hidden" name="userId" value={user.id} />
              <button className="btn w-full">{user.active ? "Pasif yap" : "Tekrar aktif yap"}</button>
            </ActionForm>
            {usage.length > 0 ? (
              <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Silinemez: {usage.join(", ")} bu kullanıcıya bağlı.</p>
            ) : (
              <ActionForm action={deleteUser}>
                <input type="hidden" name="id" value={user.id} />
                <ConfirmButton className="btn w-full text-red-600" message={`"${user.name}" kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`}>
                  Kalıcı olarak sil
                </ConfirmButton>
              </ActionForm>
            )}
          </section>
        )}
      </div>
    </>
  );
}
