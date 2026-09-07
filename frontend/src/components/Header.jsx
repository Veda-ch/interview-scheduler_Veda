import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Bell, Plus } from 'lucide-react';
import { api } from '../lib/api.js';
import NotificationDrawer from './NotificationDrawer.jsx';

export default function Header({ onOpenScheduleModal }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    async function checkUnread() {
      try {
        const data = await api.get('/notifications?take=20');
        setUnreadCount(data?.unread ?? 0);
      } catch {
        // silently ignore
      }
    }
    checkUnread();
    const timer = setInterval(checkUnread, 30000);
    return () => clearInterval(timer);
  }, []);

  // Keyboard shortcut listener for Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('global-search-input')?.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Determine title and subtitle based on current route
  function getHeaderMeta() {
    const p = location.pathname;
    if (p === '/calendar') {
      return {
        title: 'Interview Scheduler',
        subtitle: 'Schedule and manage interviews with ease.',
        actionLabel: 'Schedule Interview',
      };
    }
    if (p === '/jobs') {
      return {
        title: 'Job Openings',
        subtitle: 'Active roles, hiring pipelines, and requirements.',
        actionLabel: 'Schedule Interview',
      };
    }
    if (p === '/control-tower') {
      return {
        title: 'Control Tower',
        subtitle: 'Proactive scheduling risk detection, SLA metrics & automated recovery.',
        actionLabel: 'Schedule Interview',
      };
    }
    if (p === '/builder') {
      return {
        title: 'Schedule Builder',
        subtitle: 'Generate conflict-free slots with CP-SAT and heuristic matching.',
        actionLabel: 'Schedule Interview',
      };
    }
    if (p === '/analytics') {
      return {
        title: 'Analytics & Insights',
        subtitle: 'Time-to-hire, interviewer workload, and pipeline efficiency.',
        actionLabel: 'Schedule Interview',
      };
    }
    if (p === '/evaluations') {
      return {
        title: 'Offers & Evaluations',
        subtitle: 'Candidate scorecard evaluations, offer stages, and decisions.',
        actionLabel: 'Schedule Interview',
      };
    }
    if (p.startsWith('/candidate')) {
      return {
        title: 'Candidate Portal',
        subtitle: 'Manage your interview rounds, availability, and confirmed schedules.',
        actionLabel: 'Choose Slot',
      };
    }
    if (p.startsWith('/interviewer')) {
      return {
        title: 'Interviewer Dashboard',
        subtitle: 'Upcoming panel assignments, feedback forms, and availability.',
        actionLabel: 'Update Hours',
      };
    }
    return {
      title: 'Recruiter Dashboard',
      subtitle: 'Welcome to your interview orchestration center.',
      actionLabel: 'Schedule Interview',
    };
  }

  const { title, subtitle, actionLabel } = getHeaderMeta();

  function handlePrimaryAction() {
    if (location.pathname.startsWith('/candidate')) {
      navigate('/candidate/choose-slot');
    } else if (location.pathname.startsWith('/interviewer')) {
      navigate('/interviewer/profile');
    } else if (onOpenScheduleModal) {
      onOpenScheduleModal();
    } else {
      navigate('/calendar');
    }
  }

  return (
    <>
      <header className="h-16 bg-white border-b border-gray-200 px-6 flex items-center justify-between sticky top-0 z-20 shrink-0">
        {/* Left: Dynamic Title & Subtitle */}
        <div>
          <h1 className="text-base font-bold text-gray-900 leading-tight">
            {title}
          </h1>
          <p className="text-xs text-gray-500 leading-normal hidden sm:block">
            {subtitle}
          </p>
        </div>

        {/* Right: Search, Notifications, Primary Action Button */}
        <div className="flex items-center gap-3">
          {/* Global Search with Cmd+K hint */}
          <div className="relative hidden md:block">
            <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="global-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for candidates, jobs, or interviews..."
              className="w-72 pl-9 pr-12 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-md text-gray-900 placeholder-gray-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition"
            />
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-semibold text-gray-400 bg-white border border-gray-200 rounded shadow-2xs pointer-events-none">
              ⌘ K
            </kbd>
          </div>

          {/* Notifications Trigger Button */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="relative p-2 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition"
            title="Notifications"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 h-4 min-w-[16px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* Primary Action Button */}
          <button
            onClick={handlePrimaryAction}
            className="btn-primary flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
            <span>{actionLabel}</span>
          </button>
        </div>
      </header>

      {/* Slide-out Notification Drawer */}
      <NotificationDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCountChange={(newCount) => setUnreadCount(newCount)}
      />
    </>
  );
}
