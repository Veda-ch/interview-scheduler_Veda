import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth, DEMO_PERSONAS } from '../context/AuthContext.jsx';
import {
  Home,
  Briefcase,
  Users,
  Calendar,
  CheckSquare,
  Award,
  BarChart3,
  Sliders,
  Settings,
  Clock,
  CheckCircle2,
  User,
  LogOut,
  ChevronDown,
  Sparkles,
  Layers,
  ArrowRight,
} from 'lucide-react';

export default function Sidebar({ onOpenScheduleModal }) {
  const { user, switchPersona, switching, currentPersonaKey, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    function handleClickOutside(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const role = user?.role || 'RECRUITER';

  // Navigation config according to user role
  const recruiterLinks = [
    { to: '/', label: 'Home', icon: Home, exact: true },
    { to: '/jobs', label: 'Jobs', icon: Briefcase },
    { to: '/candidate', label: 'Candidates', icon: Users },
    { to: '/calendar', label: 'Interviews', icon: Calendar },
    { to: '/control-tower', label: 'Assessments', icon: CheckSquare },
    { to: '/evaluations', label: 'Offers', icon: Award },
    { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/builder', label: 'Templates', icon: Sliders },
  ];

  const candidateLinks = [
    { to: '/candidate', label: 'Home', icon: Home, exact: true },
    { to: '/calendar', label: 'Schedule', icon: Calendar },
    { to: '/candidate/availability', label: 'Availability', icon: Clock },
    { to: '/candidate/choose-slot', label: 'Choose Slot', icon: CheckSquare },
    { to: '/candidate/slots', label: 'Confirmations', icon: CheckCircle2 },
    { to: '/candidate/profile', label: 'Profile', icon: User },
  ];

  const interviewerLinks = [
    { to: '/interviewer', label: 'Assignments', icon: Home, exact: true },
    { to: '/calendar', label: 'Master Schedule', icon: Calendar },
    { to: '/interviewer/profile', label: 'Profile & Hours', icon: User },
  ];

  const navLinks = role === 'CANDIDATE' ? candidateLinks : role === 'INTERVIEWER' ? interviewerLinks : recruiterLinks;

  function handlePersonaSelect(key) {
    setProfileOpen(false);
    switchPersona(key).then((newUser) => {
      if (newUser?.role === 'CANDIDATE') navigate('/candidate');
      else if (newUser?.role === 'INTERVIEWER') navigate('/interviewer');
      else navigate('/');
    });
  }

  function handleLogout() {
    setProfileOpen(false);
    logout().then(() => navigate('/login'));
  }

  const avatarUrl = user?.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.avatarSeed || user?.name || 'recruiter'}`;

  return (
    <aside className="w-60 min-w-[240px] max-w-[240px] h-screen bg-gray-50 border-r border-gray-200 flex flex-col justify-between shrink-0 select-none z-30">
      {/* Top Brand Header */}
      <div className="p-5 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
            <Layers className="h-4 w-4 stroke-[2.5]" />
          </div>
          <div>
            <span className="font-bold text-base tracking-tight text-gray-900 block leading-none">
              TalentFlow
            </span>
            <span className="text-[10px] font-medium text-gray-500 tracking-wide uppercase mt-0.5 block">
              Interview Engine
            </span>
          </div>
        </div>
      </div>

      {/* Main Navigation Links */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {navLinks.map((link) => {
          const Icon = link.icon;
          const isActive = link.exact
            ? location.pathname === link.to
            : location.pathname === link.to || (link.to !== '/' && location.pathname.startsWith(link.to));

          return (
            <NavLink
              key={link.to}
              to={link.to}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-50 text-indigo-600 font-semibold'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-indigo-600 stroke-[2.2]' : 'text-gray-500'}`} />
              <span>{link.label}</span>
            </NavLink>
          );
        })}
      </div>

      {/* Bottom Section: Promo Card + Profile Widget */}
      <div className="p-3 pt-0 space-y-3">
        {/* Promo / Automation Card */}
        <div className="p-3.5 rounded-lg border border-gray-200 bg-white shadow-2xs">
          <div className="h-7 w-7 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2 border border-indigo-100">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <h5 className="text-xs font-bold text-gray-900 leading-tight">
            Automate your interview scheduling
          </h5>
          <p className="text-[11px] text-gray-500 mt-1 leading-normal">
            Let AI find the optimal conflict-free time for your interviews.
          </p>
          <button
            onClick={() => {
              if (onOpenScheduleModal) onOpenScheduleModal();
              else navigate('/calendar');
            }}
            className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700"
          >
            <span>Learn More</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {/* User Profile Widget */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="w-full flex items-center justify-between p-2 rounded-md hover:bg-gray-200/60 transition text-left"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src={avatarUrl}
                alt={user?.name || 'User'}
                className="h-8 w-8 rounded-full bg-indigo-100 border border-gray-200 shrink-0 object-cover"
              />
              <div className="min-w-0 flex-1">
                <span className="text-xs font-semibold text-gray-900 truncate block leading-snug">
                  {user?.name || 'Olivia Rhye'}
                </span>
                <span className="text-[11px] text-gray-500 truncate block leading-none">
                  {user?.email || 'olivia@talentflow.com'}
                </span>
              </div>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0 ml-1" />
          </button>

          {/* Profile Dropdown Popover */}
          {profileOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-56 rounded-lg bg-white border border-gray-200 shadow-lg py-1.5 z-50 text-xs text-gray-700 animate-fade-in">
              <div className="px-3 py-2 border-b border-gray-100">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 block">
                  Switch Demo Persona
                </span>
              </div>
              <div className="py-1">
                {Object.entries(DEMO_PERSONAS).map(([key, p]) => (
                  <button
                    key={key}
                    onClick={() => handlePersonaSelect(key)}
                    className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-gray-50 ${
                      currentPersonaKey === key ? 'font-semibold text-indigo-600 bg-indigo-50/50' : 'text-gray-700'
                    }`}
                  >
                    <span>{p.name}</span>
                    <span className="text-[10px] text-gray-400 font-normal">({p.label})</span>
                  </button>
                ))}
              </div>
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-3 py-1.5 text-rose-600 hover:bg-rose-50 flex items-center gap-1.5 font-medium"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Log Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
