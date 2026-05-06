import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useUIStore } from '@/stores';
import {
  LayoutDashboard, PenSquare, FileText,
  Settings, Upload, Menu, X, Sparkles, ChevronRight,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/new', icon: PenSquare, label: 'New Content' },
  { to: '/settings/brand', icon: Upload, label: 'Brand Voice' },
  { to: '/settings/workspace', icon: Settings, label: 'Workspace' },
  { to: '/audit', icon: FileText, label: 'Audit Trail' },
];

export default function Layout() {
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const location = useLocation();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ────────────────────────────────────── */}
      <aside
        className={`${sidebarOpen ? 'w-64' : 'w-20'
          } flex-shrink-0 bg-surface-900/80 backdrop-blur-xl border-r border-surface-700/40
             flex flex-col transition-all duration-300 ease-in-out`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-surface-700/40">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-cyan-500
                          flex items-center justify-center shadow-glow flex-shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          {sidebarOpen && (
            <div className="animate-fade-in">
              <h1 className="text-sm font-bold text-white tracking-tight">GenAI Platform</h1>
              <p className="text-[10px] text-surface-500 font-medium">Content Creation</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                 transition-all duration-200
                 ${isActive
                  ? 'bg-brand-600/15 text-brand-400 shadow-inner-glow'
                  : 'text-surface-400 hover:bg-surface-800/80 hover:text-surface-200'
                }`
              }
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {sidebarOpen && <span className="animate-fade-in">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Collapse button */}
        <div className="px-3 py-3 border-t border-surface-700/40">
          <button
            onClick={toggleSidebar}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl
                       text-surface-500 hover:text-surface-300 hover:bg-surface-800/60
                       transition-all duration-200"
          >
            {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            {sidebarOpen && <span className="text-xs">Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ── Main Content ──────────────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-surface-950">
        {/* Top bar */}
        <header className="sticky top-0 z-40 bg-surface-950/80 backdrop-blur-xl
                           border-b border-surface-700/30 px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-surface-500">
              <span>GenAI Platform</span>
              <ChevronRight className="w-3 h-3" />
              <span className="text-surface-200 font-medium">
                {navItems.find((n) => n.to === location.pathname)?.label || 'Editor'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-violet-500
                              flex items-center justify-center text-white text-xs font-bold shadow-glow">
                U
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="p-6 animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
