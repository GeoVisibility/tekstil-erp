import { ActionForm } from "@/components/ActionForm";
import { Badge, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { ORG_TYPE_LABELS } from "@/lib/labels";
import { orgScope } from "@/lib/scope";
import { requireRole } from "@/lib/session";
import { createOrganization } from "../actions";

export default async function OrganizationsPage() {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const orgs = await prisma.organization.findMany({
    where: orgScope(s),
    include: { parent: { select: { name: true } }, _count: { select: { users: true } } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  const companies = orgs.filter((o) => o.type === "COMPANY");

  return (
    <>
      <PageHeader title="Firmalar" subtitle="Firma, alt firma (fason atölye) ve müşteriler" />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Ad</th>
                <th className="th">Tip</th>
                <th className="th">Bağlı olduğu firma</th>
                <th className="th text-right">Kullanıcı</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td className="td font-medium">
                    {o.name}
                    {(o.phone || o.email) && <div className="text-xs font-normal text-slate-500">{[o.phone, o.email].filter(Boolean).join(" · ")}</div>}
                  </td>
                  <td className="td">
                    <Badge tone={o.type === "COMPANY" ? "blue" : o.type === "SUBCOMPANY" ? "amber" : "green"}>{ORG_TYPE_LABELS[o.type]}</Badge>
                  </td>
                  <td className="td">{o.parent?.name ?? "—"}</td>
                  <td className="td text-right tabular-nums">{o._count.users}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ActionForm action={createOrganization} className="card card-pad h-fit space-y-3">
          <h2 className="font-semibold">Yeni ekle</h2>
          <div>
            <label className="label">Ad *</label>
            <input name="name" className="input" required />
          </div>
          <div>
            <label className="label">Tip *</label>
            {/* Hiç firma yoksa (ilk kurulum) varsayılan tip "Firma" olsun */}
            <select name="type" className="input" defaultValue={s.role === "DEVELOPER" && companies.length === 0 ? "COMPANY" : "SUBCOMPANY"}>
              {s.role === "DEVELOPER" && <option value="COMPANY">Firma</option>}
              <option value="SUBCOMPANY">Alt Firma</option>
              <option value="CUSTOMER">Müşteri</option>
            </select>
          </div>
          {s.role === "DEVELOPER" && (
            <div>
              <label className="label">Bağlı firma (alt firma / müşteri için)</label>
              <select name="parentId" className="input">
                <option value="">—</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Telefon</label>
              <input name="phone" className="input" />
            </div>
            <div>
              <label className="label">E-posta</label>
              <input name="email" type="email" className="input" />
            </div>
          </div>
          <button className="btn-primary w-full">Kaydet</button>
        </ActionForm>
      </div>
    </>
  );
}
