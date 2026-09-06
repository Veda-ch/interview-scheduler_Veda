import React, { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import {
  X,
  Bell,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Clock,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import { DateTime } from 'luxon';

export default function NotificationDrawer({ isOpen, onClose, onCountChange }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadNotifications();
    }
  }, [isOpen]);

  async function loadNotifications() {
    setLoading(true);
    try {
      // The API returns { items, unread } - not a bare array.
      const data = await api.get('/notifications?take=25');
      const items = data?.items || [];
      setNotifications(items);
      onCountChange?.(data?.unread ?? items.filter((n) => n.status !== 'READ').length);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      setLoading(false);
    }
  }

  async function markAsRead(id) {
    try {
      await api.post('/notifications/read', { ids: [id] });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, status: 'READ' } : n))
      );
      const unread = notifications.filter((n) => n.id !== id && n.status !== 'READ').length;
      onCountChange?.(unread);
    } catch (err) {
      console.error('Failed to mark read:', err);
    }
  }

  async function markAllAsRead() {
    try {
      await api.post('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, status: 'READ' })));
      onCountChange?.(0);
    } catch (err) {
      console.error('Failed to mark all read:', err);
    }
  }

  if (!isOpen) return null;

  function getIcon(type) {
    switch (type) {
      case 'INTERVIEW_SCHEDULED':
      case 'INTERVIEW_CONFIRMED':
        return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
      case 'INTERVIEW_RESCHEDULED':
      case 'RESCHEDULE_REQUESTED':
        return <RefreshCw className="h-5 w-5 text-blue-600" />;
      case 'INCIDENT_RAISED':
      case 'APPROVAL_REQUIRED':
        return <AlertTriangle className="h-5 w-5 text-rose-600" />;
      case 'INTERVIEW_REMINDER':
        return <Clock className="h-5 w-5 text-amber-600" />;
      case 'FEEDBACK_REQUESTED':
        return <MessageSquare className="h-5 w-5 text-purple-600" />;
      default:
        return <Calendar className="h-5 w-5 text-sky-600" />;
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/30 backdrop-blur-xs">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl border-l border-sky-100 flex flex-col animate-fade-in">
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-sky-50/50">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-sky-100 text-sky-700">
                <Bell className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Notifications</h3>
                <p className="text-xs text-slate-500">Live dispatch & reminder alerts</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {notifications.some((n) => n.status !== 'READ') && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline px-2 py-1"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-2">
            {loading && (
              <div className="flex justify-center items-center py-16 text-slate-400 text-sm">
                <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                Loading alerts...
              </div>
            )}

            {!loading && notifications.length === 0 && (
              <div className="text-center py-16 px-4">
                <div className="mx-auto w-12 h-12 rounded-full bg-sky-50 flex items-center justify-center text-sky-600 mb-3">
                  <Bell className="h-6 w-6" />
                </div>
                <h4 className="text-sm font-semibold text-slate-800">No notifications yet</h4>
                <p className="text-xs text-slate-500 mt-1">
                  You will receive invitations, slot confirmations, and reminder alerts here.
                </p>
              </div>
            )}

            {!loading &&
              notifications.map((n) => {
                const isUnread = n.status !== 'READ';
                const timeAgo = DateTime.fromISO(n.createdAt).toRelative() || 'recently';
                return (
                  <div
                    key={n.id}
                    onClick={() => isUnread && markAsRead(n.id)}
                    className={`p-3.5 rounded-xl transition cursor-pointer flex gap-3 ${
                      isUnread
                        ? 'bg-sky-50/70 hover:bg-sky-100/60 border border-sky-100'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">{getIcon(n.type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {n.title}
                        </span>
                        <span className="text-[11px] text-slate-400 shrink-0">{timeAgo}</span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line line-clamp-3">
                        {n.body}
                      </p>
                      {n.personalized && (
                        <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-100">
                          <Sparkles className="h-2.5 w-2.5" /> AI personalized
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>

          <div className="p-3 border-t border-slate-100 bg-slate-50/50 text-center">
            <span className="text-[11px] text-slate-500 font-medium">
              In-app, SMTP Email & SMS alerts synced
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
