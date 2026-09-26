import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  Boxes,
  ChartColumn,
  ChevronUp,
  History,
  LayoutGrid,
  LogOut,
  type LucideIcon,
  MapPin,
  Menu,
  Monitor,
  Moon,
  Package,
  Plus,
  RefreshCcw,
  ScanLine,
  Search,
  Sun,
  Tags,
  ScrollText,
  Settings2,
  UserRound,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { api, qs } from "../lib/api";
import { useAuth, useIsManager } from "../lib/auth";
import { DOC_TYPE_LIST, docPath, fmtQty } from "../lib/format";
import { useLiveUpdates } from "../lib/live";
import { type ThemePref, useTheme } from "../lib/theme";
import { useDebounced } from "../lib/queries";
import type { SearchResults } from "../lib/types";
import { NotificationBell } from "./Notifications";
import { ScanDialog, type ScanResult } from "./Scanner";
import { Avatar, StatusBadge } from "./ui";

export function RolePill({ role }: { role: "manager" | "staff" }) {
  return (
    <span
      className={clsx(
        "mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
        role === "manager" ? "bg-brand-50 text-brand-700" : "bg-info-50 text-info",
      )}
    >
      {role === "manager" ? "Inventory manager" : "Warehouse staff"}
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx("flex items-center gap-2 text-brand", className)}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
        <path d="M16 2.5 28 9v14l-12 6.5L4 23V9z" fill="currentColor" />
        <path d="M16 2.5 28 9l-12 6.5L4 9z" fill="#fff" fillOpacity=".3" />
        <path d="M16 15.5v14" stroke="#fff" strokeOpacity=".55" strokeWidth="1.6" />
      </svg>
      <span className="text-[22px] font-bold tracking-tight">stocksense</span>
    </span>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  managerOnly?: boolean;
}

const NAV: { heading?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: "/", label: "Dashboard", icon: LayoutGrid, end: true },
      { to: "/analytics", label: "Analytics", icon: ChartColumn },
    ],
  },
  {
    heading: "Operations",
    items: DOC_TYPE_LIST.map((m) => ({ to: `/operations/${m.slug}`, label: m.plural, icon: m.icon })),
  },
  {
    heading: "Products",
    items: [
      { to: "/products", label: "All products", icon: Package, end: true },
      { to: "/stock", label: "Stock", icon: Boxes },
      { to: "/products/categories", label: "Categories", icon: Tags },
      { to: "/products/reordering", label: "Reordering rules", icon: RefreshCcw },
    ],
  },
  { items: [{ to: "/moves", label: "Move history", icon: History }] },
  {
    heading: "Settings",
    items: [
      { to: "/settings/warehouses", label: "Warehouses", icon: Warehouse },
      { to: "/settings/locations", label: "Locations", icon: MapPin },
      { to: "/settings/team", label: "Team", icon: Users, managerOnly: true },
      { to: "/settings/general", label: "General", icon: Settings2 },
      { to: "/settings/audit", label: "Audit log", icon: ScrollText, managerOnly: true },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const isManager = useIsManager();
  return (
    <div className="flex h-full flex-col">
      <Link to="/" onClick={onNavigate} className="flex h-20 shrink-0 items-center px-6">
        <Logo />
      </Link>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pt-2 pb-6">
        {NAV.map((group, i) => (
          <div key={group.heading ?? i}>
            {group.heading && (
              <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-subtle uppercase">{group.heading}</p>
            )}
            <ul className="space-y-0.5">
              {group.items.filter((item) => isManager || !item.managerOnly).map(({ to, label, icon: Icon, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      clsx(
                        "flex h-10 items-center gap-3 rounded-lg px-3 text-[15px] transition",
                        isActive ? "bg-canvas font-semibold text-ink" : "text-muted hover:bg-canvas/70 hover:text-ink",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={clsx("size-[18px]", isActive && "text-brand")} strokeWidth={isActive ? 2.25 : 1.9} />
                        {label}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <ProfileMenu onNavigate={onNavigate} />
    </div>
  );
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onOutside]);
}

function ProfileMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useClickOutside(ref, () => setOpen(false));
  if (!user) return null;

  return (
    <div ref={ref} className="relative border-t border-hairline p-3">
      {open && (
        <div className="animate-rise-in absolute right-3 bottom-full left-3 mb-2 overflow-hidden rounded-xl border border-hairline bg-white py-2 shadow-pop">
          <Link
            to="/profile"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="flex items-center gap-3 px-4 py-2.5 text-[15px] hover:bg-canvas"
          >
            <UserRound className="size-4" /> My profile
          </Link>
          <div className="my-1 h-px bg-hairline" />
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-canvas"
          >
            <LogOut className="size-4" /> Log out
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-canvas"
      >
        <Avatar name={user.name} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{user.name}</span>
          <RolePill role={user.role} />
        </span>
        <ChevronUp className={clsx("size-4 text-muted transition", !open && "rotate-180")} />
      </button>
    </div>
  );
}

/** Light / Dark / System choice, remembered per browser. */
export function ThemeSwitch() {
  const [pref, setPref] = useTheme();
  const options: { key: ThemePref; label: string; icon: LucideIcon }[] = [
    { key: "light", label: "Light", icon: Sun },
    { key: "dark", label: "Dark", icon: Moon },
    { key: "system", label: "System", icon: Monitor },
  ];
  return (
    <div className="px-4 py-2">
      <p className="mb-1.5 text-xs font-semibold text-muted">Appearance</p>
      <div className="flex rounded-full border border-line p-0.5" role="radiogroup" aria-label="Appearance">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={pref === o.key}
            onClick={() => setPref(o.key)}
            className={clsx(
              "flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-semibold transition",
              pref === o.key ? "bg-ink text-white" : "text-muted hover:text-ink",
            )}
          >
            <o.icon className="size-3.5" /> {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Avatar menu in the top-right corner (mirrors the sidebar profile menu). */
function HeaderProfile() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useClickOutside(ref, () => setOpen(false));
  if (!user) return null;
  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-11 items-center gap-2 rounded-full border border-line bg-white pr-1.5 pl-3 transition hover:shadow-card"
      >
        <Menu className="size-4" strokeWidth={2.25} />
        <Avatar name={user.name} size="sm" />
      </button>
      {open && (
        <div className="animate-rise-in absolute top-full right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-hairline bg-white py-2 shadow-pop">
          <div className="px-4 py-2.5">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-xs text-muted">@{user.loginId} · {user.role === "manager" ? "Inventory manager" : "Warehouse staff"}</p>
          </div>
          <div className="my-1 h-px bg-hairline" />
          <ThemeSwitch />
          <div className="my-1 h-px bg-hairline" />
          <Link to="/profile" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-[15px] hover:bg-canvas">
            <UserRound className="size-4" /> My profile
          </Link>
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-canvas"
          >
            <LogOut className="size-4" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const term = useDebounced(q.trim(), 200);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  useClickOutside(ref, () => setOpen(false));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useQuery({
    queryKey: ["search", term],
    queryFn: () => api<SearchResults>(`/search${qs({ q: term })}`),
    enabled: term.length > 0,
    placeholderData: (prev) => prev,
  });

  const go = (path: string) => {
    setOpen(false);
    setQ("");
    input.current?.blur();
    navigate(path);
  };

  const data = results.data;
  const empty = data && data.products.length === 0 && data.documents.length === 0;

  return (
    <div ref={ref} className="relative w-full max-w-[520px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) go(`/products?q=${encodeURIComponent(q.trim())}`);
        }}
        className="flex h-12 items-center rounded-full border border-line bg-white pr-2 pl-4 shadow-card sm:pl-6 transition focus-within:shadow-pop hover:shadow-pop"
      >
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && (setOpen(false), input.current?.blur())}
          placeholder="Search SKU, product or reference"
          aria-label="Search"
          className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted"
        />
        <kbd className="mr-2 hidden rounded-md border border-line px-1.5 text-[11px] text-muted md:block">/</kbd>
        <button type="submit" aria-label="Search" className="brand-gradient grid size-8 place-items-center rounded-full text-on-brand">
          <Search className="size-3.5" strokeWidth={3} />
        </button>
      </form>

      {open && term && data && (
        <div className="animate-rise-in absolute inset-x-0 top-full z-40 mt-3 overflow-hidden rounded-3xl border border-hairline bg-white py-3 shadow-pop">
          {empty && <p className="px-6 py-4 text-sm text-muted">No matches for “{term}”</p>}
          {data.products.length > 0 && (
            <SearchGroup title="Products">
              {data.products.map((p) => (
                <button key={p.id} type="button" onClick={() => go(`/products/${p.id}`)} className="flex w-full items-center gap-3 px-6 py-2.5 text-left hover:bg-canvas">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-canvas">
                    <Package className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {p.sku}
                      {p.category && ` · ${p.category.name}`}
                    </span>
                  </span>
                  <span className="text-sm text-muted">
                    {fmtQty(p.onHand)} {p.uom}
                  </span>
                </button>
              ))}
            </SearchGroup>
          )}
          {data.documents.length > 0 && (
            <SearchGroup title="Operations">
              {data.documents.map((d) => (
                <button key={d.id} type="button" onClick={() => go(docPath(d))} className="flex w-full items-center gap-3 px-6 py-2.5 text-left hover:bg-canvas">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{d.reference}</span>
                    {d.partnerName && <span className="block truncate text-xs text-muted">{d.partnerName}</span>}
                  </span>
                  <StatusBadge status={d.status} />
                </button>
              ))}
            </SearchGroup>
          )}
        </div>
      )}
    </div>
  );
}

function SearchGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="py-1">
      <p className="px-6 pt-1 pb-1.5 text-xs font-semibold text-muted">{title}</p>
      {children}
    </div>
  );
}

/** Header scan button: scan a product label or a printed document to open it. */
function GlobalScan() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const onScan = async (code: string): Promise<ScanResult> => {
    const res = await api<SearchResults>(`/search${qs({ q: code })}`);
    const product = res.products.find((p) => p.sku.toLowerCase() === code.toLowerCase());
    const document = res.documents.find((d) => d.reference.toLowerCase() === code.toLowerCase());
    if (product) {
      navigate(`/products/${product.id}`);
      return { ok: true, message: `Opening ${product.name}` };
    }
    if (document) {
      navigate(docPath(document));
      return { ok: true, message: `Opening ${document.reference}` };
    }
    return { ok: false, message: "No product or document with that code" };
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Scan a barcode"
        title="Scan a barcode"
        className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-white transition hover:shadow-card sm:size-11"
      >
        <ScanLine className="size-[18px]" />
      </button>
      <ScanDialog open={open} onClose={() => setOpen(false)} onScan={onScan} continuous={false} title="Scan to open" hint="Scan a product label or the barcode on a printed receipt or delivery." />
    </>
  );
}

function CreateMenu() {
  const isManager = useIsManager();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-11 items-center gap-2 rounded-full border border-line bg-white pr-4 pl-3 text-sm font-semibold transition hover:shadow-card"
      >
        <Plus className="size-4" strokeWidth={2.5} />
        <span className="hidden sm:inline">Create</span>
      </button>
      {open && (
        <div className="animate-rise-in absolute top-full right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-hairline bg-white py-2 shadow-pop">
          {DOC_TYPE_LIST.map((m) => (
            <Link key={m.type} to={`/operations/${m.slug}/new`} onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-[15px] hover:bg-canvas">
              <m.icon className="size-4" /> New {m.label.toLowerCase()}
            </Link>
          ))}
          {isManager && (
            <>
              <div className="my-1 h-px bg-hairline" />
              <Link to="/products/new" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-[15px] hover:bg-canvas">
                <Package className="size-4" /> New product
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const live = useLiveUpdates();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="min-h-screen lg:pl-64 print:pl-0">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-hairline bg-white lg:block print:hidden">
        <Sidebar />
      </aside>

      {drawer && (
        <div className="animate-fade-in fixed inset-0 z-50 bg-black/40 lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <aside className="animate-slide-in relative h-full w-72 max-w-[85vw] bg-white shadow-lift">
            <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="absolute top-6 right-4 grid size-8 place-items-center rounded-full hover:bg-canvas">
              <X className="size-4" />
            </button>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 border-b border-hairline bg-white/95 backdrop-blur print:hidden">
        <div className="flex h-20 items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-10">
          <button type="button" aria-label="Open menu" onClick={() => setDrawer(true)} className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-canvas lg:hidden">
            <Menu className="size-5" />
          </button>
          <div className="flex flex-1 justify-center lg:justify-start">
            <GlobalSearch />
          </div>
          <span
            title={live ? "Live — updates appear instantly" : "Reconnecting…"}
            className="hidden items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-muted sm:flex"
          >
            <span className="relative flex size-2">
              {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />}
              <span className={clsx("relative inline-flex size-2 rounded-full", live ? "bg-ok" : "bg-subtle")} />
            </span>
            {live ? "Live" : "Offline"}
          </span>
          <GlobalScan />
          <CreateMenu />
          <NotificationBell />
          <HeaderProfile />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1320px] px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
