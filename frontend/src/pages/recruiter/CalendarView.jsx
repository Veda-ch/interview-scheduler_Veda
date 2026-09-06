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
          backgroundColor: isConfirmed ? '#9333ea' : '#6366f1',
          borderColor: isConfirmed ? '#7e22ce' : '#4f46e5',
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
            backgroundColor: blocked ? '#f1f5f9' : '#f0fdf4',
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
          backgroundColor: '#0284c7',
          borderColor: '#0369a1',
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
      {/* Top Banner */}
      <div className="card p-6 bg-gradient-to-r from-purple-50 via-white to-sky-50/50 border border-sky-100 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center font-extrabold text-lg shadow-sm">
              <CalendarIcon className="h-6 w-6" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-purple-800 bg-purple-100/70 px-2.5 py-0.5 rounded-full border border-purple-200">
                Master Schedule
              </span>
              <h1 className="text-2xl font-extrabold text-slate-900 mt-1">
                Master Interview Calendar
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap self-start sm:self-auto">
            <select
              value={personKey}
              onChange={(e) => setPersonKey(e.target.value)}
              className="input text-xs py-2 px-3 border-slate-200 bg-white text-slate-900 font-semibold cursor-pointer max-w-[220px]"
              title="Show declared availability for one person"
            >
              <option value="">Filter by person...</option>
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
              className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5 font-bold"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-purple-600 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4 text-xs font-medium text-slate-600 bg-slate-50/80 p-3 rounded-xl border border-slate-200">
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded-sm border border-emerald-300" style={{ background: '#f0fdf4' }} /> Available window
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded-sm border border-slate-300" style={{ background: '#f1f5f9' }} /> Blocked / Busy
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded-sm" style={{ background: '#9333ea' }} /> Confirmed interview
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded-sm" style={{ background: '#0284c7' }} /> Requested date window
        </span>
        {!personKey && (
          <span className="text-slate-400 italic text-[11px] ml-auto">Select an interviewer or candidate above to see their schedule.</span>
        )}
      </div>

      {/* Calendar Card Container */}
      <div className="card p-6 bg-white border border-sky-100 shadow-sm relative rounded-2xl">
        {loading && (
          <div className="absolute inset-0 z-10 bg-white/70 backdrop-blur-xs flex items-center justify-center text-xs font-bold text-slate-900 rounded-2xl">
            <RefreshCw className="h-5 w-5 animate-spin mr-2 text-purple-600" />
            Updating calendar...
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
          events={events}
          eventClick={handleEventClick}
          slotMinTime="08:00:00"
          slotMaxTime="21:00:00"
          allDaySlot={false}
          height="auto"
          nowIndicator={true}
          expandRows={true}
        />
      </div>

      {/* Selected Event Details Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-fade-in">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 text-[10px] font-bold uppercase tracking-wider">
                  {selectedEvent.extendedProps.interviewType}
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-1.5">
                  {selectedEvent.extendedProps.roundName}
                </h3>
                <span className="text-xs text-slate-500 font-medium">
                  Candidate: <strong className="text-slate-900 font-bold">{selectedEvent.extendedProps.candidateName}</strong>
                </span>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors font-bold"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-2.5">
                <Clock className="h-4 w-4 text-purple-600 shrink-0" />
                <div>
                  <span className="font-bold text-slate-900 block">
                    {DateTime.fromJSDate(selectedEvent.start).toFormat('cccc, LLL dd, yyyy')}
                  </span>
                  <span className="text-slate-500 font-medium">
                    {DateTime.fromJSDate(selectedEvent.start).toFormat('hh:mm a')} –{' '}
                    {DateTime.fromJSDate(selectedEvent.end).toFormat('hh:mm a')} (Local)
                  </span>
                </div>
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
                  Assigned Panelists
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {selectedEvent.extendedProps.panel?.map((p, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 font-medium border border-purple-200 text-xs"
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
                    className="btn-primary w-full text-xs py-2.5 flex items-center justify-center gap-2 font-bold shadow-sm"
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
