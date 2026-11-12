import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Badge, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { ORG_TYPE_LABELS, ORG_TYPE_TONES } from "@/lib/labels";
import { orgScope } from "@/lib/scope";
import { requireRole } from "@/lib/session";
import { orgUsage } from "@/lib/usage";
import { deleteOrganization, toggleOrgActive, updateOrganization } from "../../actions";

export default async function OrganizationEditPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const { id } = await params;
  const org = await prisma.organization.findFirst({
    where: { AND: [{ id }, orgScope(s)] },
    include: { users: { select: { id: true, name: true, email: true, active: true }, orderBy: { name: "asc" } } },
  });
  if (!org) notFound();

  const [usage, companies] = await Promise.all([
    orgUsage(org.id),
    s.role === "DEVELOPER" ? prisma.organization.findMany({ where: { type: "COMPANY", id: { not: org.id } }, orderBy: { name: "asc" } }) : [],
  ]);
  const isSelf = org.id === s.orgId;
  // Firma kullanıcısı kendi firmasının tipini değiştiremez
  const typeLocked = s.role === "COMPANY" && isSelf;

  return (
    <>
      <PageHeader
        title={org.name}
        subtitle={
          <span className="flex items-center gap-2">
            <Badge tone={ORG_TYPE_TONES[org.type]}>{ORG_TYPE_LABELS[org.type]}</Badge>
            {!org.active && <Badge tone="red">Pasif</Badge>}
          </span>
        }
        actions={<Link href="/admin/organizations" className="btn">← Firmalar</Link>}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <ActionForm key={`${org.name}|${org.type}|${org.parentId}|${org.phone}|${org.email}`} action={updateOrganization} className="card card-pad grid h-fit gap-4 sm:grid-cols-2">
          <input type="hidden" name="id" value={org.id} />
          <div className="sm:col-span-2">
            <label className="label">Ad *</label>
            <input name="name" defaultValue={org.name} className="input" required minLength={2} />
          </div>
          <div>
            <label className="label">Tip</label>
            {typeLocked ? (
              <>
                <input type="hidden" name="type" value={org.type} />
                <div className="input bg-slate-50">{ORG_TYPE_LABELS[org.type]}</div>
              </>
            ) : (
              <select name="type" defaultValue={org.type} className="input">
                {s.role === "DEVELOPER" && <option value="COMPANY">Firma</option>}
                <option value="SUBCOMPANY">Alt Firma</option>
                <option value="CUSTOMER">Müşteri</option>
              <option value="SUPPLIER">Tedarikçi</option>
              </select>
            )}
            <p className="mt-1 text-xs text-slate-500">Tip değişirse bu kayda bağlı kullanıcıların yetkisi de değişir.</p>
          </div>
          {s.role === "DEVELOPER" ? (
            <div>
              <label className="label">Bağlı firma (alt firma / müşteri / tedarikçi için)</label>
              <select name="parentId" defaultValue={org.parentId ?? ""} className="input">
                <option value="">—</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div />
          )}
          <div>
            <label className="label">Telefon</label>
            <input name="phone" defaultValue={org.phone ?? ""} className="input" />
          </div>
          <div>
            <label className="label">E-posta</label>
            <input name="email" type="email" defaultValue={org.email ?? ""} className="input" />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <button className="btn-primary">Değişiklikleri kaydet</button>
          </div>
        </ActionForm>

        <div className="space-y-4">
          <section className="card card-pad">
            <h2 className="mb-2 text-sm font-semibold">Kullanıcılar ({org.users.length})</h2>
            {org.users.length === 0 ? (
              <p className="text-sm text-slate-500">Bu kayda bağlı kullanıcı yok.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {org.users.map((u) => (
                  <li key={u.id}>
                    <Link href={`/admin/users/${u.id}`} className={`text-indigo-700 hover:underline ${u.active ? "" : "opacity-50"}`}>{u.name}</Link>
                    <span className="text-xs text-slate-500"> · {u.email}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!isSelf && (
            <section className="card card-pad space-y-3">
              <h2 className="text-sm font-semibold">Pasif yap / sil</h2>
              <p className="text-xs text-slate-500">
                Pasif kayıtlar listelerde ve seçim kutularında görünmez, kullanıcıları giriş yapamaz. Geçmiş kayıtlar korunur.
              </p>
              <ActionForm action={toggleOrgActive}>
                <input type="hidden" name="id" value={org.id} />
                <button className="btn w-full">{org.active ? "Pasif yap" : "Tekrar aktif yap"}</button>
              </ActionForm>
              {usage.length > 0 ? (
                <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  Silinemez: {usage.join(", ")} bağlı. Hatalı girişse önce bağlı kayıtları düzeltin ya da pasif yapın.
                </p>
              ) : (
                <ActionForm action={deleteOrganization}>
                  <input type="hidden" name="id" value={org.id} />
                  <ConfirmButton className="btn w-full text-red-600" message={`"${org.name}" kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`}>
                    Kalıcı olarak sil
                  </ConfirmButton>
                </ActionForm>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
