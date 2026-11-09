// Rollerin ve sayfa erişimlerinin TEK kaynağı.
// Hem middleware (sayfa koruması) hem de menü bu dosyayı kullanır.

export const ROLES = ["DEVELOPER", "COMPANY", "SUBCOMPANY", "CUSTOMER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  DEVELOPER: "Developer",
  COMPANY: "Firma",
  SUBCOMPANY: "Alt Firma",
  CUSTOMER: "Müşteri",
};

export type NavItem = { href: string; label: string; roles: Role[] };

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Genel Bakış", roles: ["DEVELOPER", "COMPANY", "SUBCOMPANY", "CUSTOMER"] },
  { href: "/sales", label: "Sipariş Listesi", roles: ["DEVELOPER", "COMPANY"] },
  { href: "/orders", label: "Üretim Siparişleri", roles: ["DEVELOPER", "COMPANY", "CUSTOMER"] },
  { href: "/tasks", label: "Görevlerim", roles: ["DEVELOPER", "COMPANY", "SUBCOMPANY"] },
  { href: "/products", label: "Ürün Tanımları", roles: ["DEVELOPER", "COMPANY"] },
  { href: "/admin/organizations", label: "Firmalar", roles: ["DEVELOPER", "COMPANY"] },
  { href: "/admin/users", label: "Kullanıcılar", roles: ["DEVELOPER", "COMPANY"] },
];

// Menüde görünmeyen ama korunması gereken alt sayfalar
const EXTRA_RULES: NavItem[] = [
  { href: "/orders/new", label: "Yeni Sipariş", roles: ["DEVELOPER", "COMPANY"] },
];

/** Verilen yol için izin verilen roller (en uzun eşleşen kural kazanır). */
export function allowedRolesFor(pathname: string): Role[] | null {
  const rules = [...EXTRA_RULES, ...NAV_ITEMS].sort((a, b) => b.href.length - a.href.length);
  const rule = rules.find((r) => pathname === r.href || pathname.startsWith(r.href + "/"));
  return rule ? rule.roles : null;
}

export function navFor(role: Role) {
  return NAV_ITEMS.filter((i) => i.roles.includes(role));
}

/** Firma tarafı yönetim yetkisi (sipariş açma, görev atama) */
export function canManage(role: Role) {
  return role === "DEVELOPER" || role === "COMPANY";
}
