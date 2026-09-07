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
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Video,
  ArrowLeft,
  Copy,
  Check,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { DateTime } from 'luxon';

export default function NotificationDrawer({ isOpen, onClose, onCountChange }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    if (isOpen) {
      loadNotifications();
    } else {
      setSelectedNotification(null);
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
      if (selectedNotification?.id === id) {
        setSelectedNotification((prev) => (prev ? { ...prev, status: 'READ' } : prev));
      }
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
      if (selectedNotification) {
        setSelectedNotification((prev) => (prev ? { ...prev, status: 'READ' } : prev));
      }
      onCountChange?.(0);
    } catch (err) {
      console.error('Failed to mark all read:', err);
    }
  }

  function handleToggleExpand(n) {
    if (n.status !== 'READ') {
      markAsRead(n.id);
    }
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(n.id)) {
        next.delete(n.id);
      } else {
        next.add(n.id);
      }
      return next;
    });
  }

  function handleOpenFullMessage(n, e) {
    e?.stopPropagation();
    if (n.status !== 'READ') {
      markAsRead(n.id);
    }
    setSelectedNotification(n);
  }

  function handleCopyText(id, text, e) {
    e?.stopPropagation();
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

  function extractMeetingUrl(text) {
    if (!text) return null;
    const match = text.match(/https?:\/\/[^\s]+/);
    return match ? match[0] : null;
  }

  function renderFormattedBody(text) {
    if (!text) return null;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 font-semibold text-purple-700 hover:text-purple-950 underline bg-purple-100/70 hover:bg-purple-200/80 px-1.5 py-0.5 rounded transition text-[11px] break-all"
          >
            {part}
            <ExternalLink className="h-3 w-3 inline shrink-0" />
          </a>
        );
      }
      return part;
    });
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
            {selectedNotification ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedNotification(null)}
                  className="p-1.5 rounded-lg text-purple-800 hover:text-purple-950 hover:bg-purple-200/70 transition flex items-center gap-1 text-xs font-bold"
                  title="Back to all notifications"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Back</span>
                </button>
                <span className="text-xs font-bold text-purple-950 truncate max-w-[220px]">
                  {selectedNotification.title}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-200 text-purple-950 font-bold">
                  <Bell className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-purple-950">Notifications</h3>
                  <p className="text-xs font-semibold text-purple-900/60">Live dispatch & reminder alerts</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              {!selectedNotification && notifications.some((n) => n.status !== 'READ') && (
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

          {/* Full Message Detail View (When a message is opened in detail view) */}
          {selectedNotification ? (
            <div className="flex-1 overflow-y-auto p-5 bg-purple-50/30 flex flex-col gap-4">
              <div className="bg-white rounded-2xl p-5 border border-purple-200/90 shadow-xs">
                <div className="flex items-start gap-3 mb-4">
                  <div className="p-2.5 rounded-xl bg-purple-100 shrink-0">
                    {getIcon(selectedNotification.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-extrabold text-purple-950 leading-snug">
                      {selectedNotification.title}
                    </h4>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-purple-900/60 font-medium">
                      <span>
                        {DateTime.fromISO(selectedNotification.createdAt).toFormat('fff') || 'Recently'}
                      </span>
                      <span>•</span>
                      <span className="capitalize font-semibold text-purple-800">
                        {selectedNotification.channel?.toLowerCase().replace('_', ' ') || 'In-app'}
                      </span>
                      {selectedNotification.status === 'READ' && (
                        <>
                          <span>•</span>
                          <span className="text-purple-600 font-semibold">Read</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {selectedNotification.personalized && (
                  <div className="mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-purple-900 bg-purple-100/90 px-2.5 py-1 rounded-full border border-purple-200">
                    <Sparkles className="h-3 w-3 text-purple-700" />
                    AI Personalized Dispatch
                  </div>
                )}

                {/* Complete message body */}
                <div className="border-t border-purple-100 pt-4">
                  <h5 className="text-[11px] font-bold uppercase tracking-wider text-purple-900/50 mb-2">
                    Message Body
                  </h5>
                  <div className="p-3.5 bg-purple-50/60 rounded-xl border border-purple-100 text-xs text-purple-950 font-normal leading-relaxed whitespace-pre-wrap">
                    {renderFormattedBody(selectedNotification.body)}
                  </div>
                </div>

                {/* Detected Meeting Link Action */}
                {extractMeetingUrl(selectedNotification.body) && (
                  <div className="mt-4">
                    <a
                      href={extractMeetingUrl(selectedNotification.body)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold shadow-xs hover:shadow transition"
                    >
                      <Video className="h-4 w-4" />
                      {extractMeetingUrl(selectedNotification.body)?.includes('meet.google.com')
                        ? 'Join Google Meet'
                        : extractMeetingUrl(selectedNotification.body)?.includes('zoom.us')
                        ? 'Join Zoom Meeting'
                        : 'Join Meeting'}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                )}

                {/* Action footer */}
                <div className="mt-4 pt-3 border-t border-purple-100 flex items-center justify-between">
                  <button
                    onClick={(e) => handleCopyText(selectedNotification.id, selectedNotification.body, e)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-purple-700 hover:text-purple-950 px-2.5 py-1.5 rounded-lg hover:bg-purple-50 transition"
                  >
                    {copiedId === selectedNotification.id ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="text-emerald-700">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy message</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setSelectedNotification(null)}
                    className="text-xs font-bold text-purple-800 hover:text-purple-950 hover:underline px-2.5 py-1.5"
                  >
                    Back to all alerts
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* List View with Accordion Expansion */
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
                  const isExpanded = expandedIds.has(n.id);
                  const timeAgo = DateTime.fromISO(n.createdAt).toRelative() || 'recently';
                  const fullTime = DateTime.fromISO(n.createdAt).toFormat('ff');
                  const meetingUrl = extractMeetingUrl(n.body);

                  return (
                    <div
                      key={n.id}
                      onClick={() => handleToggleExpand(n)}
                      className={`p-3.5 rounded-xl transition cursor-pointer flex flex-col gap-2 ${
                        isUnread
                          ? 'bg-purple-50/90 hover:bg-purple-100/70 border border-purple-200 shadow-xs'
                          : isExpanded
                          ? 'bg-purple-50/50 border border-purple-200/80'
                          : 'hover:bg-purple-50/40'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 shrink-0">{getIcon(n.type)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="text-xs font-bold text-purple-950 truncate">
                              {n.title}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[11px] font-semibold text-purple-900/50">
                                {timeAgo}
                              </span>
                              {isExpanded ? (
                                <ChevronUp className="h-3.5 w-3.5 text-purple-600" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 text-purple-400" />
                              )}
                            </div>
                          </div>

                          {/* Message preview or complete message */}
                          <div
                            className={`text-xs text-purple-900/85 leading-relaxed whitespace-pre-line ${
                              isExpanded
                                ? 'bg-white p-3 rounded-lg border border-purple-100 text-purple-950'
                                : 'line-clamp-2'
                            }`}
                          >
                            {isExpanded ? renderFormattedBody(n.body) : n.body}
                          </div>

                          {/* Extra info & action buttons when expanded */}
                          {isExpanded && (
                            <div
                              className="mt-2.5 pt-2 border-t border-purple-100 flex flex-wrap items-center justify-between gap-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={(e) => handleOpenFullMessage(n, e)}
                                  className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-700 hover:text-purple-950 bg-purple-100/80 hover:bg-purple-200 px-2 py-1 rounded-lg transition"
                                  title="Open full view"
                                >
                                  <Maximize2 className="h-3 w-3" />
                                  <span>Open full view</span>
                                </button>
                                <button
                                  onClick={(e) => handleCopyText(n.id, n.body, e)}
                                  className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-600 hover:text-purple-900 px-2 py-1 rounded-lg hover:bg-purple-100/50 transition"
                                  title="Copy text"
                                >
                                  {copiedId === n.id ? (
                                    <>
                                      <Check className="h-3 w-3 text-emerald-600" />
                                      <span className="text-emerald-700">Copied</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3" />
                                      <span>Copy</span>
                                    </>
                                  )}
                                </button>
                              </div>

                              <span className="text-[10px] text-purple-900/50 font-medium">
                                {fullTime}
                              </span>
                            </div>
                          )}

                          {/* Prominent Quick-Join Meeting Button if link is present and expanded */}
                          {isExpanded && meetingUrl && (
                            <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                              <a
                                href={meetingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-800 text-white text-[11px] font-bold shadow-xs hover:shadow transition"
                              >
                                <Video className="h-3.5 w-3.5" />
                                {meetingUrl.includes('meet.google.com')
                                  ? 'Join Google Meet'
                                  : meetingUrl.includes('zoom.us')
                                  ? 'Join Zoom Meeting'
                                  : 'Join Meeting'}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          )}

                          {/* Personalized badge */}
                          {n.personalized && (
                            <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-purple-900 bg-purple-100 px-2 py-0.5 rounded-full border border-purple-200">
                              <Sparkles className="h-2.5 w-2.5" /> AI personalized
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

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

