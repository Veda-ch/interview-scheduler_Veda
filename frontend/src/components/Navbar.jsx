import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth, DEMO_PERSONAS } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import NotificationDrawer from './NotificationDrawer.jsx';
import {
  Calendar,
  Layers,
  Sparkles,
  Briefcase,
  Award,
  Trophy,
  ShieldAlert,
  BarChart3,
  Clock,
  Bell,
  Users,
  CheckCircle2,
  ChevronDown,
  UserCheck,
  Compass,
  Video,
  LogOut,
  LogIn,
  User,
} from 'lucide-react';

export default function Navbar() {
  const { user, switchPersona, switching, currentPersonaKey, logout } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    async function checkUnread() {
      try {
        // The API returns { items, unread } - trust the server's unread count.
        const data = await api.get('/notifications?take=20');
        setUnreadCount(data?.unread ?? 0);
      } catch {
        // silently ignore on mount
      }
    }
    if (user) {
      checkUnread();
      const timer = setInterval(checkUnread, 30000);
      return () => clearInterval(timer);
    }
  }, [user]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (!e.target.closest('#persona-dropdown')) {
        setSwitcherOpen(false);
      }
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const persona = DEMO_PERSONAS[currentPersonaKey] || DEMO_PERSONAS.RECRUITER;

  function handlePersonaSwitch(key) {
    setSwitcherOpen(false);
    switchPersona(key).then((newUser) => {
      if (newUser?.role === 'CANDIDATE') navigate('/candidate');
      else if (newUser?.role === 'INTERVIEWER') navigate('/interviewer');
      else navigate('/');
    });
  }

  function handleLogout() {
    setSwitcherOpen(false);
    logout().then(() => {
      navigate('/login');
    });
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-sky-100 bg-white/95 backdrop-blur-md shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-4">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-600/20">
                <Compass className="h-6 w-6 animate-pulse" />
              </div>
              <div>
                <span className="font-extrabold text-base tracking-tight text-slate-900 flex items-center gap-1.5">
                  Slotify
                  <span className="text-[10px] uppercase font-extrabold tracking-wider bg-purple-100/80 text-purple-800 px-2 py-0.5 rounded-full border border-purple-200">
                    Recruiter
                  </span>
                </span>
              </div>
            </div>

            {/* Navigation Tabs based on role */}
            <nav className="hidden md:flex items-center">
              {user?.role === 'RECRUITER' && (
                <div className="bg-slate-100/80 p-1 rounded-2xl border border-slate-200/80 backdrop-blur-xs flex items-center gap-1 shadow-2xs">
                  <NavLink
                    to="/"
                    end
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 ${
                        isActive
                          ? 'bg-white text-slate-900 font-extrabold shadow-xs border border-slate-200/90'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                      }`
                    }
                  >
                    <Layers className="h-4 w-4 text-purple-600" />
                    Dashboard
                  </NavLink>
                  <NavLink
                    to="/jobs"
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 ${
                        isActive
                          ? 'bg-white text-slate-900 font-extrabold shadow-xs border border-slate-200/90'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                      }`
                    }
                  >
                    <Briefcase className="h-4 w-4 text-purple-600" />
                    Jobs
                  </NavLink>
                  <NavLink
                    to="/builder"
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 ${
                        isActive
                          ? 'bg-white text-slate-900 font-extrabold shadow-xs border border-slate-200/90'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                      }`
                    }
                  >
                    <Sparkles className="h-4 w-4 text-purple-600" />
                    Schedule Builder
                  </NavLink>
                  <NavLink
                    to="/calendar"
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 ${
                        isActive
                          ? 'bg-white text-slate-900 font-extrabold shadow-xs border border-slate-200/90'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                      }`
                    }
                  >
                    <Calendar className="h-4 w-4 text-purple-600" />
                    Calendar
                  </NavLink>
                  <NavLink
                    to="/control-tower"
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 ${
                        isActive
                          ? 'bg-white text-slate-900 font-extrabold shadow-xs border border-slate-200/90'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                      }`
                    }
                  >
                    <ShieldAlert className="h-4 w-4 text-purple-600" />
                    Issue Monitor
                  </NavLink>
                  <NavLink
                    to="/evaluations"
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 ${
                        isActive
                          ? 'bg-white text-slate-900 font-extrabold shadow-xs border border-slate-200/90'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                      }`
                    }
                  >
                    <Trophy className="h-4 w-4 text-purple-600" />
                    Evaluations
                  </NavLink>
                  <NavLink
                    to="/analytics"
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 ${
                        isActive
                          ? 'bg-white text-slate-900 font-extrabold shadow-xs border border-slate-200/90'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                      }`
                    }
                  >
                    <BarChart3 className="h-4 w-4 text-purple-600" />
                    Analytics
                  </NavLink>
                </div>
              )}

              {user?.role === 'CANDIDATE' && (
                <>
                  <NavLink
                    to="/candidate"
                    end
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                        isActive
                          ? 'bg-emerald-100 text-emerald-800 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-sky-50/70'
                      }`
                    }
                  >
                    <Calendar className="h-4 w-4 text-emerald-600" />
                    My Interviews
                  </NavLink>
                  <NavLink
                    to="/candidate/slots"
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                        isActive
                          ? 'bg-purple-100 text-purple-800 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-purple-50/70'
                      }`
                    }
                  >
                    <Sparkles className="h-4 w-4 text-purple-600" />
                    Choose Time Slot
                  </NavLink>
                  <NavLink
                    to="/candidate/profile"
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                        isActive
                          ? 'bg-sky-100 text-brand-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-sky-50/70'
                      }`
                    }
                  >
                    <User className="h-4 w-4 text-brand-600" />
                    My Profile & Skills
                  </NavLink>
                </>
              )}

              {user?.role === 'INTERVIEWER' && (
                <>
                  <NavLink
                    to="/interviewer"
                    end
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                        isActive
                          ? 'bg-purple-100 text-purple-800 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-sky-50/70'
                      }`
                    }
                  >
                    <Users className="h-4 w-4 text-purple-600" />
                    Assigned Interviews
                  </NavLink>
                  <NavLink
                    to="/interviewer/profile"
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                        isActive
                          ? 'bg-sky-100 text-brand-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-sky-50/70'
                      }`
                    }
                  >
                    <Award className="h-4 w-4 text-brand-600" />
                    My Skills & Availability
                  </NavLink>
                  <NavLink
                    to="/calendar"
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                        isActive
                          ? 'bg-sky-100 text-brand-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-sky-50/70'
                      }`
                    }
                  >
                    <Calendar className="h-4 w-4 text-emerald-600" />
                    My Calendar
                  </NavLink>
                </>
              )}
            </nav>

            {/* Right Controls: Notifications & Persona Switcher */}
            <div className="flex items-center gap-3">
              {!user ? (
                <NavLink
                  to="/login"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-900 hover:bg-purple-950 text-white text-xs font-bold shadow-xs transition"
                >
                  <LogIn className="h-4 w-4" />
                  Sign In
                </NavLink>
              ) : (
                <>
                  {/* Notification Button */}
                  <button
                    onClick={() => setDrawerOpen(true)}
                    className="relative p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition shadow-xs"
                    title="Notifications"
                  >
                    <Bell className="h-4 w-4 text-slate-700" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-extrabold text-white shadow-xs animate-bounce">
                        {unreadCount}
                      </span>
                    )}
                  </button>

                  {/* USER / PERSONA PROFILE DROPDOWN */}
                  <div className="relative" id="persona-dropdown">
                    <button
                      onClick={() => setSwitcherOpen(!switcherOpen)}
                      disabled={switching}
                      className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition shadow-xs"
                    >
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt={user.name}
                          className="h-7 w-7 rounded-lg object-cover border border-slate-200"
                        />
                      ) : (
                        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center text-xs font-extrabold text-white">
                          {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                        </div>
                      )}
                      <div className="text-left hidden sm:block">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-900 max-w-[120px] truncate">
                            {user.name}
                          </span>
                          <span
                            className={`text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded border ${
                              persona.badgeClass
                            }`}
                          >
                            {user.role}
                          </span>
                        </div>
                        <span className="text-[10px] font-medium text-slate-500 block -mt-0.5">
                          {user.timezone || 'UTC'}
                        </span>
                      </div>
                      <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                    </button>

                    {/* Dropdown Menu */}
                    {switcherOpen && (
                      <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-white p-2 shadow-2xl border border-slate-200 divide-y divide-slate-100 z-50 animate-fade-in">
                        {/* Current User Header */}
                        <div className="px-3 py-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold text-slate-900 truncate">
                              {user.name}
                            </span>
                            <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border ${persona.badgeClass}`}>
                              {user.role}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-500 block truncate mt-0.5">
                            {user.email}
                          </span>
                        </div>

                        {/* Quick Role Switcher for Evaluation */}
                        <div className="py-2">
                          <div className="px-3 mb-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                              Evaluation Role Switcher
                            </span>
                            <span className="text-[10px] text-slate-500">
                              Instant perspective change:
                            </span>
                          </div>
                          <div className="space-y-1">
                            {Object.entries(DEMO_PERSONAS).map(([key, p]) => {
                              const isCurrent = user.role === p.role;
                              return (
                                <button
                                  key={key}
                                  onClick={() => handlePersonaSwitch(key)}
                                  className={`w-full text-left p-2 rounded-xl transition flex items-center gap-2.5 ${
                                    isCurrent
                                      ? 'bg-purple-50 text-purple-900 border border-purple-200 font-bold'
                                      : 'hover:bg-slate-50 text-slate-700 font-medium'
                                  }`}
                                >
                                  <div className="h-7 w-7 rounded-lg bg-purple-100 text-purple-800 flex items-center justify-center font-extrabold text-xs shrink-0">
                                    {p.name.charAt(0)}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-bold text-slate-900 truncate">
                                        {p.name}
                                      </span>
                                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${p.badgeClass}`}>
                                        {p.label}
                                      </span>
                                    </div>
                                    <span className="text-[10px] text-slate-500 block truncate">
                                      {p.desc}
                                    </span>
                                  </div>
                                  {isCurrent && (
                                    <CheckCircle2 className="h-4 w-4 text-purple-600 shrink-0" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Sign Out Action */}
                        <div className="pt-1.5">
                          <button
                            type="button"
                            onClick={handleLogout}
                            className="w-full text-left px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 flex items-center gap-2 text-xs font-bold transition"
                          >
                            <LogOut className="h-4 w-4" />
                            Sign Out
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Slide-over notifications drawer */}
      <NotificationDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCountChange={setUnreadCount}
      />
    </>
  );
}
