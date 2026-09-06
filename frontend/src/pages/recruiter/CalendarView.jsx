import React, { useState, useEffect } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { api } from '../../lib/api.js';
import {
  Calendar as CalendarIcon,
  Clock,
  Users,
  Video,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Info,
} from 'lucide-react';
import { DateTime } from 'luxon';

export default function CalendarView() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Whose declared availability to paint underneath the interviews.
  const [people, setPeople] = useState([]);
  const [personKey, setPersonKey] = useState('');

  useEffect(() => {
    loadPeople();
  }, []);

  useEffect(() => {
    loadCalendarData();
  }, [personKey]);

  async function loadPeople() {
    const [ivs, cands] = await Promise.all([
      api.get('/interviewers').catch(() => []),
      api.get('/candidates?take=100').catch(() => ({ items: [] })),
    ]);
    setPeople([
      ...(ivs || []).map((i) => ({ key: `interviewer:${i.id}`, name: i.name, group: 'Interviewers' })),
      ...((cands?.items) || []).map((c) => ({ key: `candidate:${c.id}`, name: c.name, group: 'Candidates' })),
    ]);
  }

  async function loadCalendarData() {
    setLoading(true);
    try {
      const [interviews, requests] = await Promise.all([
        api.get('/interviews?take=50').catch(() => []),
        api.get('/interview-requests').catch(() => []),
      ]);

      const formattedInterviews = (interviews || []).map((iv) => {
        const candidateName = iv.candidate?.name || 'Candidate';
        const roundName = iv.round?.name || 'Interview';
        const isConfirmed = iv.status === 'CONFIRMED';
        return {
          id: iv.id,
          title: `🔒 ${roundName} — ${candidateName}`,
          start: iv.startUtc,
          end: iv.endUtc,
          backgroundColor: '#2563eb',
          borderColor: isConfirmed ? '#1e3a8a' : '#1d4ed8',
          textColor: '#ffffff',
          extendedProps: {
            roundName,
            candidateName,
            jobTitle: iv.job?.title,
            interviewType: iv.round?.type,
            status: iv.status,
            panel: iv.panel || [],
            joinUrl: iv.meeting?.joinUrl,
          },
        };
      });

      // Declared availability for the selected person, painted as background
      // blocks so interviews sit on top of them rather than competing.
      let availabilityEvents = [];
      if (personKey) {
        const [kind, id] = personKey.split(':');
        const path = kind === 'interviewer' ? `/interviewers/${id}/availability` : `/candidates/${id}/availability`;
        const windows = await api.get(path).catch(() => []);
        availabilityEvents = (windows || []).map((w) => {
          const blocked = w.kind === 'UNAVAILABLE';
          return {
            id: `avail-${w.id}`,
            start: w.startUtc,
            end: w.endUtc,
            display: 'background',
            backgroundColor: blocked ? '#fecaca' : '#bbf7d0',
            extendedProps: { isAvailability: true, kind: w.kind },
          };
        });
      }

      const formattedRequests = (requests || []).map((req) => {
        const candidateName = req.candidate?.name || 'Candidate';
        const roundName = req.roundName || 'Interview Round';
        return {
          id: `req-${req.id}`,
          title: `📅 Window: ${roundName} (${candidateName})`,
          start: req.earliestUtc,
          end: req.latestUtc,
          backgroundColor: '#f59e0b',
          borderColor: '#d97706',
          textColor: '#ffffff',
          extendedProps: {
            roundName: `Window: ${roundName}`,
            candidateName,
            jobTitle: req.job?.title,
            interviewType: req.interviewType,
            status: req.status,
            panel: [],
            isWindow: true,
          },
        };
      });

      setEvents([...availabilityEvents, ...formattedRequests, ...formattedInterviews]);
    } catch (err) {
      console.error('Failed to load calendar events:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleEventClick(clickInfo) {
    if (clickInfo.event.extendedProps?.isAvailability) return;
    setSelectedEvent(clickInfo.event);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <CalendarIcon className="h-6 w-6 text-brand-600" />
            Participant Availability & Scheduled Interviews
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Booked interviews across everyone, with one person's declared availability underneath.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={personKey}
            onChange={(e) => setPersonKey(e.target.value)}
            className="input text-xs py-2 cursor-pointer max-w-[220px]"
            title="Show declared availability for one person"
          >
            <option value="">Show availability for...</option>
            {['Interviewers', 'Candidates'].map((group) => (
              <optgroup key={group} label={group}>
                {people.filter((p) => p.group === group).map((p) => (
                  <option key={p.key} value={p.key}>{p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            onClick={loadCalendarData}
            className="btn-ghost text-xs py-2 px-3 text-slate-600 flex items-center gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4 text-xs text-slate-600">
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded-sm" style={{ background: '#bbf7d0' }} /> Available
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded-sm" style={{ background: '#fecaca' }} /> Unavailable
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded-sm" style={{ background: '#2563eb' }} /> Scheduled interview
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded-sm" style={{ background: '#f59e0b' }} /> Requested date window
        </span>
        {!personKey && (
          <span className="text-slate-400">Pick a person above to see their availability.</span>
        )}
      </div>

      {/* Calendar Card Container */}
      <div className="card p-6 bg-white border border-sky-100 shadow-sm relative">
        {loading && (
          <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-xs flex items-center justify-center text-sm font-semibold text-slate-600">
            <RefreshCw className="h-5 w-5 animate-spin mr-2 text-brand-600" />
            Syncing participant schedules...
          </div>
        )}

        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          slotMinTime="08:00:00"
          slotMaxTime="21:00:00"
          allDaySlot={false}
          events={events}
          eventClick={handleEventClick}
          height="auto"
          expandRows={true}
        />
      </div>

      {/* Event Details Flyout Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-sky-100 animate-fade-in">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-brand-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                  {selectedEvent.extendedProps.interviewType}
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-1">
                  {selectedEvent.extendedProps.roundName}
                </h3>
                <span className="text-xs text-slate-500">
                  Candidate: <strong>{selectedEvent.extendedProps.candidateName}</strong>
                </span>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-sky-50/50 border border-sky-100 flex items-center gap-2.5">
                <Clock className="h-4 w-4 text-brand-600 shrink-0" />
                <div>
                  <span className="font-bold text-slate-900 block">
                    {DateTime.fromJSDate(selectedEvent.start).toFormat('cccc, LLL dd, yyyy')}
                  </span>
                  <span className="text-slate-600 font-medium">
                    {DateTime.fromJSDate(selectedEvent.start).toFormat('hh:mm a')} –{' '}
                    {DateTime.fromJSDate(selectedEvent.end).toFormat('hh:mm a')} (Local)
                  </span>
                </div>
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                  Assigned Panelists
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {selectedEvent.extendedProps.panel?.map((p, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 rounded-lg bg-slate-100 text-slate-800 font-semibold border border-slate-200"
                    >
                      {p.name || 'Panelist'}
                    </span>
                  ))}
                </div>
              </div>

              {selectedEvent.extendedProps.joinUrl && (
                <div className="pt-2">
                  <a
                    href={`/meeting/${selectedEvent.id}`}
                    className="btn-primary w-full text-xs py-2 flex items-center justify-center gap-2"
                  >
                    <Video className="h-4 w-4" /> Enter Virtual Meeting Room
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
