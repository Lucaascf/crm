"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, Kanban, Calendar, CheckSquare, Truck, LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";

const ITEMS = [
  { href: "/", label: "Início", icon: Home },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/funil", label: "Funil", icon: Kanban },
  { href: "/agenda", label: "Agenda", icon: Calendar },
  { href: "/tarefas", label: "Tarefas", icon: CheckSquare },
  { href: "/mudancas", label: "Mudanças", icon: Truck },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export default function Nav({
  user,
}: {
  user: { name: string; email: string };
}) {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop: barra lateral */}
      <nav className="hidden md:flex md:flex-col md:w-56 md:shrink-0 md:border-r md:border-neutral-200 md:bg-white md:min-h-screen md:py-6 md:px-3">
        <div className="px-3 mb-8 flex items-center gap-2">
          <span className="text-2xl">🚚</span>
          <span className="font-bold text-lg text-neutral-900 leading-tight">
            Central de
            <br />
            Mudanças
          </span>
        </div>
        <ul className="flex flex-col gap-1">
          {ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors ${
                    active
                      ? "bg-orange-50 text-orange-700"
                      : "text-neutral-600 hover:bg-neutral-100"
                  }`}
                >
                  <Icon size={20} strokeWidth={2} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-auto pt-4 px-3 border-t border-neutral-200">
          <p className="text-sm font-medium text-neutral-800 truncate">{user.name}</p>
          <p className="text-xs text-neutral-500 truncate mb-2">{user.email}</p>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-rose-600"
            >
              <LogOut size={16} />
              Sair
            </button>
          </form>
        </div>
      </nav>

      {/* Mobile: barra inferior fixa */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-neutral-200 pb-[env(safe-area-inset-bottom)]">
        <ul className="flex justify-between">
          {ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                    active ? "text-orange-700" : "text-neutral-500"
                  }`}
                >
                  <Icon size={22} strokeWidth={active ? 2.4 : 2} />
                  {label}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <form action={logoutAction}>
              <button
                type="submit"
                className="w-full flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-neutral-500"
              >
                <LogOut size={22} strokeWidth={2} />
                Sair
              </button>
            </form>
          </li>
        </ul>
      </nav>
    </>
  );
}
