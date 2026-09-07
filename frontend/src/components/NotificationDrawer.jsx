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
      const data = await api.get('/notifications?take=30');
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
            className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-800 underline bg-indigo-50 px-1.5 py-0.5 rounded text-[11px] break-all"
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
        return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
      case 'INTERVIEW_RESCHEDULED':
      case 'RESCHEDULE_REQUESTED':
        return <RefreshCw className="h-4 w-4 text-amber-600" />;
      case 'INCIDENT_RAISED':
      case 'APPROVAL_REQUIRED':
        return <AlertTriangle className="h-4 w-4 text-rose-600" />;
      case 'INTERVIEW_REMINDER':
        return <Clock className="h-4 w-4 text-indigo-600" />;
      case 'FEEDBACK_REQUESTED':
        return <MessageSquare className="h-4 w-4 text-indigo-600" />;
      default:
        return <Calendar className="h-4 w-4 text-gray-500" />;
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/25 backdrop-blur-2xs select-none">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white shadow-xl border-l border-gray-200 flex flex-col animate-fade-in">
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between bg-white">
            {selectedNotification ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedNotification(null)}
                  className="p-1.5 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition flex items-center gap-1 text-xs font-semibold"
                  title="Back to all notifications"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Back</span>
                </button>
                <span className="text-xs font-bold text-gray-900 truncate max-w-[200px]">
                  {selectedNotification.title}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-md bg-indigo-50 text-indigo-600">
                  <Bell className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Notifications</h3>
                  <p className="text-[11px] text-gray-500">Live dispatch & reminder alerts</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              {!selectedNotification && notifications.some((n) => n.status !== 'READ') && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline px-2 py-1"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Full Message View */}
          {selectedNotification ? (
            <div className="flex-1 overflow-y-auto p-5 bg-gray-50 flex flex-col gap-4">
              <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-xs">
                <div className="flex items-start gap-3 mb-3">
                  <div className="p-2 rounded-md bg-gray-50 shrink-0 border border-gray-200">
                    {getIcon(selectedNotification.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-bold text-gray-900 leading-snug">
                      {selectedNotification.title}
                    </h4>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-gray-500">
                      <span>
                        {DateTime.fromISO(selectedNotification.createdAt).toFormat('fff') || 'Recently'}
                      </span>
                      <span>•</span>
                      <span className="capitalize text-gray-700 font-medium">
                        {selectedNotification.channel?.toLowerCase().replace('_', ' ') || 'In-app'}
                      </span>
                      {selectedNotification.status === 'READ' && (
                        <>
                          <span>•</span>
                          <span className="text-indigo-600 font-medium">Read</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {selectedNotification.personalized && (
                  <div className="mb-3 inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                    <Sparkles className="h-3 w-3 text-indigo-600" />
                    AI Personalized Dispatch
                  </div>
                )}

                {/* Body */}
                <div className="border-t border-gray-100 pt-3">
                  <div className="p-3 bg-gray-50 rounded-md border border-gray-200 text-xs text-gray-900 leading-relaxed whitespace-pre-wrap font-mono text-[11px]">
                    {renderFormattedBody(selectedNotification.body)}
                  </div>
                </div>

                {/* Detected Meeting Link Action */}
                {extractMeetingUrl(selectedNotification.body) && (
                  <div className="mt-3">
                    <a
                      href={extractMeetingUrl(selectedNotification.body)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary w-full flex items-center justify-center gap-2"
                    >
                      <Video className="h-3.5 w-3.5" />
                      <span>
                        {extractMeetingUrl(selectedNotification.body)?.includes('meet.google.com')
                          ? 'Join Google Meet'
                          : 'Join Meeting'}
                      </span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}

                {/* Action footer */}
                <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                  <button
                    onClick={(e) => handleCopyText(selectedNotification.id, selectedNotification.body, e)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100 transition"
                  >
                    {copiedId === selectedNotification.id ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="text-emerald-700">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy text</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setSelectedNotification(null)}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline px-2 py-1"
                  >
                    Back to all alerts
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* List View */
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 p-2">
              {loading && (
                <div className="flex justify-center items-center py-12 text-gray-400 text-xs font-medium">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2 text-indigo-600" />
                  Loading alerts...
                </div>
              )}

              {!loading && notifications.length === 0 && (
                <div className="text-center py-16 px-4">
                  <div className="mx-auto w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-2">
                    <Bell className="h-5 w-5" />
                  </div>
                  <h4 className="text-xs font-bold text-gray-800">No notifications</h4>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    You will receive invitations, schedule updates, and alerts here.
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
                      className={`p-3 rounded-lg transition cursor-pointer flex flex-col gap-1.5 ${
                        isUnread
                          ? 'bg-indigo-50/50 hover:bg-indigo-50/80 border border-indigo-100'
                          : isExpanded
                          ? 'bg-gray-50 border border-gray-200'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5 shrink-0">{getIcon(n.type)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold text-gray-900 truncate">
                              {n.title}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-[10px] text-gray-400 font-medium">
                                {timeAgo}
                              </span>
                              {isExpanded ? (
                                <ChevronUp className="h-3 w-3 text-gray-500" />
                              ) : (
                                <ChevronDown className="h-3 w-3 text-gray-400" />
                              )}
                            </div>
                          </div>

                          <div
                            className={`text-[11px] text-gray-600 leading-relaxed mt-1 ${
                              isExpanded
                                ? 'bg-white p-2.5 rounded border border-gray-200 text-gray-900 whitespace-pre-wrap'
                                : 'line-clamp-2'
                            }`}
                          >
                            {isExpanded ? renderFormattedBody(n.body) : n.body}
                          </div>

                          {/* Action row when expanded */}
                          {isExpanded && (
                            <div
                              className="mt-2 pt-2 border-t border-gray-200 flex flex-wrap items-center justify-between gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={(e) => handleOpenFullMessage(n, e)}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded transition"
                                >
                                  <Maximize2 className="h-3 w-3" />
                                  <span>Open full view</span>
                                </button>
                                <button
                                  onClick={(e) => handleCopyText(n.id, n.body, e)}
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-800 px-2 py-0.5 rounded hover:bg-gray-100 transition"
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

                              <span className="text-[10px] text-gray-400 font-medium">
                                {fullTime}
                              </span>
                            </div>
                          )}

                          {/* Quick Join Button if expanded */}
                          {isExpanded && meetingUrl && (
                            <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                              <a
                                href={meetingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn-primary w-full flex items-center justify-center gap-1.5 py-1.5"
                              >
                                <Video className="h-3.5 w-3.5" />
                                <span>Join Google Meet</span>
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          <div className="p-2.5 border-t border-gray-200 bg-gray-50 text-center">
            <span className="text-[11px] text-gray-400 font-medium">
              In-app, SMTP Email & SMS alerts synced
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
