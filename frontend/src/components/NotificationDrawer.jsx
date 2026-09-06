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
        return <CheckCircle2 className="h-5 w-5 text-purple-800" />;
      case 'INTERVIEW_RESCHEDULED':
      case 'RESCHEDULE_REQUESTED':
        return <RefreshCw className="h-5 w-5 text-purple-700" />;
      case 'INCIDENT_RAISED':
      case 'APPROVAL_REQUIRED':
        return <AlertTriangle className="h-5 w-5 text-purple-950" />;
      case 'INTERVIEW_REMINDER':
        return <Clock className="h-5 w-5 text-purple-600" />;
      case 'FEEDBACK_REQUESTED':
        return <MessageSquare className="h-5 w-5 text-purple-800" />;
      default:
        return <Calendar className="h-5 w-5 text-purple-700" />;
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-purple-950/40 backdrop-blur-xs">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl border-l border-purple-200 flex flex-col animate-fade-in">
          {/* Header */}
          <div className="px-6 py-4 border-b border-purple-200/80 flex items-center justify-between bg-purple-50/80">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-purple-200 text-purple-950 font-bold">
                <Bell className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-purple-950">Notifications</h3>
                <p className="text-xs font-semibold text-purple-900/60">Live dispatch & reminder alerts</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {notifications.some((n) => n.status !== 'READ') && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs font-bold text-purple-800 hover:text-purple-950 hover:underline px-2 py-1"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-purple-400 hover:text-purple-700 hover:bg-purple-100 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto divide-y divide-purple-100 p-2.5">
            {loading && (
              <div className="flex justify-center items-center py-16 text-purple-400 text-sm font-semibold">
                <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                Loading alerts...
              </div>
            )}

            {!loading && notifications.length === 0 && (
              <div className="text-center py-16 px-4">
                <div className="mx-auto w-12 h-12 rounded-2xl bg-purple-100 flex items-center justify-center text-purple-700 mb-3 border border-purple-200">
                  <Bell className="h-6 w-6" />
                </div>
                <h4 className="text-sm font-bold text-purple-950">No notifications yet</h4>
                <p className="text-xs text-purple-900/60 mt-1">
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
                        ? 'bg-purple-50/90 hover:bg-purple-100/70 border border-purple-200'
                        : 'hover:bg-purple-50/50'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">{getIcon(n.type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-xs font-bold text-purple-950 truncate">
                          {n.title}
                        </span>
                        <span className="text-[11px] font-semibold text-purple-900/50 shrink-0">{timeAgo}</span>
                      </div>
                      <p className="text-xs text-purple-900/80 leading-relaxed whitespace-pre-line line-clamp-3">
                        {n.body}
                      </p>
                      {n.personalized && (
                        <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-purple-900 bg-purple-100 px-2 py-0.5 rounded-full border border-purple-200">
                          <Sparkles className="h-2.5 w-2.5" /> AI personalized
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>

          <div className="p-3 border-t border-purple-200/80 bg-purple-50/50 text-center">
            <span className="text-[11px] text-purple-900/60 font-semibold">
              In-app, SMTP Email & SMS alerts synced
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
