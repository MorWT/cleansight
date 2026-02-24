import React, { useState } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  LayoutDashboard,
  Camera,
  ClipboardList,
  Users,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Eye,
  Menu,
  X
} from "lucide-react";

const navItems = [
  { name: "Dashboard", icon: LayoutDashboard, page: "Dashboard" },
  { name: "Cameras", icon: Camera, page: "Cameras" },
  { name: "Missions", icon: ClipboardList, page: "Missions" },
  { name: "Team", icon: Users, page: "Team" },
  { name: "Analytics", icon: BarChart3, page: "Analytics" },
  { name: "Settings", icon: Settings, page: "Settings" },
];

export default function Layout({ children, currentPageName }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="dark min-h-screen bg-[#0a0e1a] text-gray-100 flex">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full z-50 flex flex-col border-r border-white/[0.06] bg-[#0d1225]/95 backdrop-blur-xl transition-all duration-300 
          ${collapsed ? "w-[72px]" : "w-[240px]"}
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-5 border-b border-white/[0.06] gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shrink-0">
            <Eye className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <span className="text-sm font-semibold tracking-wide whitespace-nowrap">
              CleanVision AI
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = currentPageName === item.page;
            return (
              <Link
                key={item.page}
                to={createPageUrl(item.page)}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 group
                  ${isActive
                    ? "bg-cyan-500/10 text-cyan-400"
                    : "text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]"
                  }`}
              >
                <item.icon className={`w-[18px] h-[18px] shrink-0 transition-colors ${isActive ? "text-cyan-400" : "text-gray-500 group-hover:text-gray-300"}`} />
                {!collapsed && <span>{item.name}</span>}
                {isActive && !collapsed && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-400" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle (desktop) */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:flex h-12 items-center justify-center border-t border-white/[0.06] text-gray-500 hover:text-gray-300 transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </aside>

      {/* Main */}
      <div className={`flex-1 transition-all duration-300 ${collapsed ? "lg:ml-[72px]" : "lg:ml-[240px]"}`}>
        {/* Top bar */}
        <header className="h-14 flex items-center px-4 lg:px-6 border-b border-white/[0.06] bg-[#0d1225]/80 backdrop-blur-md sticky top-0 z-30">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 -ml-2 text-gray-400 hover:text-white"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-medium text-emerald-400">System Active</span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}