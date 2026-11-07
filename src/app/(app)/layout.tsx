import { SidebarNav } from "@/components/SidebarNav";
import { prisma } from "@/lib/db";
import { navFor, ROLE_LABELS } from "@/lib/roles";
import { requireSession } from "@/lib/session";
import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const org = session.orgId
    ? await prisma.organization.findUnique({ where: { id: session.orgId }, select: { name: true } })
    : null;
  const items = navFor(session.role).map(({ href, label }) => ({ href, label }));

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white">T</div>
          <div className="text-sm font-semibold leading-tight">
            Tekstil Üretim
            <div className="text-xs font-normal text-slate-500">Takip Sistemi</div>
          </div>
        </div>
        <div className="px-3 pb-3 md:flex-1">
          <SidebarNav items={items} />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 md:block md:py-4">
          <div className="text-sm font-medium">{session.name}</div>
          <div className="text-xs text-slate-500">
            {ROLE_LABELS[session.role]}
            {org && ` · ${org.name}`}
          </div>
          <form action={logout} className="md:mt-3">
            <button className="btn btn-xs md:w-full">Çıkış yap</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
