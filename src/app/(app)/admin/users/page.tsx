import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Badge, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { ORG_TYPE_LABELS } from "@/lib/labels";
import { ROLE_LABELS } from "@/lib/roles";
import { orgScope } from "@/lib/scope";
import { requireRole } from "@/lib/session";
import { createUser, toggleUserActive } from "../actions";

export default async function UsersPage() {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const allOrgs = await prisma.organization.findMany({ where: orgScope(s), orderBy: [{ type: "asc" }, { name: "asc" }] });
  const orgs = allOrgs.filter((o) => o.active); // yeni kullanıcı yalnızca aktif kayda bağlanabilir
  const users = await prisma.user.findMany({
    where: s.role === "DEVELOPER" ? {} : { organizationId: { in: allOrgs.map((o) => o.id) } },
    include: { organization: { select: { name: true } } },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return (
    <>
      <PageHeader title="Kullanıcılar" subtitle="Kullanıcının rolü bağlı olduğu organizasyonun tipinden belirlenir" />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[620px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Kullanıcı</th>
                <th className="th">Rol</th>
                <th className="th">Organizasyon</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className={u.active ? "" : "opacity-50"}>
                  <td className="td">
                    <Link href={`/admin/users/${u.id}`} className="font-medium text-indigo-700 hover:underline">{u.name}</Link>
                    <div className="text-xs text-slate-500">{u.email}</div>
                  </td>
                  <td className="td"><Badge tone={u.role === "DEVELOPER" ? "red" : "blue"}>{ROLE_LABELS[u.role]}</Badge></td>
                  <td className="td">{u.organization?.name ?? "—"}</td>
                  <td className="td text-right">
                    {u.id !== s.uid && (
                      <ActionForm action={toggleUserActive}>
                        <input type="hidden" name="userId" value={u.id} />
                        <button className="btn btn-xs">{u.active ? "Pasif yap" : "Aktif yap"}</button>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ActionForm action={createUser} className="card card-pad h-fit space-y-3">
          <h2 className="font-semibold">Yeni kullanıcı</h2>
          <div>
            <label className="label">Ad soyad *</label>
            <input name="name" className="input" required />
          </div>
          <div>
            <label className="label">E-posta *</label>
            <input name="email" type="email" className="input" required />
          </div>
          <div>
            <label className="label">Geçici şifre * (en az 8 karakter)</label>
            <input name="password" type="password" minLength={8} className="input" required autoComplete="new-password" />
          </div>
          <div>
            <label className="label">Organizasyon</label>
            {orgs.length === 0 ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Henüz organizasyon yok. Firma, alt firma veya müşteri kullanıcısı eklemek için önce{" "}
                <Link href="/admin/organizations" className="font-medium underline">Firmalar</Link> ekranından kayıt açın.
              </p>
            ) : (
              <select name="organizationId" className="input">
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name} ({ORG_TYPE_LABELS[o.type]})</option>
                ))}
              </select>
            )}
          </div>
          {s.role === "DEVELOPER" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="role" value="DEVELOPER" className="h-4 w-4 accent-indigo-600" />
              Developer yetkisi ver (organizasyon yok sayılır)
            </label>
          )}
          <button className="btn-primary w-full">Kullanıcı oluştur</button>
        </ActionForm>
      </div>
    </>
  );
}
