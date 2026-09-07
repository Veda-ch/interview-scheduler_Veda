import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Clock, ArrowLeft, CheckCircle2, AlertCircle, CalendarCheck, User } from 'lucide-react';
import { DateTime } from 'luxon';

/**
 * Pick a time from the interviewer's own availability.
 *
 * Reached in two situations, both of which skip matching entirely:
 *   - none of the candidate's proposed times could be used, or
 *   - they are moving an interview they already have.
 * Either way these slots come from one interviewer's declared availability, so
 * choosing one books it there and then.
 */
export default function ChooseSlot() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const requestId = params.get('requestId');
  const mode = params.get('mode') === 'reschedule' ? 'reschedule' : 'offered';
  const interviewId = params.get('interviewId');
  const zone = user?.timezone || 'UTC';

  const [request, setRequest] = useState(null);
  const [interviewer, setInterviewer] = useState(null);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    if (!requestId) return;
    load();
  }, [requestId]);

  async function load() {
    setLoading(true);
    try {
      const [req, offered] = await Promise.all([
        api.get(`/interview-requests/${requestId}`),
        api.get(`/interview-requests/${requestId}/offered-slots`),
      ]);
      setRequest(req);
      setInterviewer(offered?.interviewer ?? null);
      setSlots(offered?.slots ?? []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load the available times');
    } finally {
      setLoading(false);
    }
  }

  async function choose(slot) {
    if (!interviewer) return;
    setBooking(slot.startUtc);
    setError(null);
    try {
      if (mode === 'reschedule' && interviewId) {
        // Moving an existing booking keeps the same panel - only the time changes.
        await api.postOnce(`/interviews/${interviewId}/candidate-reschedule`, {
          startUtc: slot.startUtc,
          endUtc: slot.endUtc,
        });
      } else {
        await api.postOnce(`/interview-requests/${requestId}/choose-slot`, {
          interviewerId: interviewer.id,
          startUtc: slot.startUtc,
          endUtc: slot.endUtc,
        });
      }
      setSuccess(
        mode === 'reschedule'
          ? `Moved to ${slot.label}. Everyone has been told.`
          : `Booked for ${slot.label}. A calendar invite is on its way.`
      );
      setTimeout(() => navigate('/candidate'), 1400);
    } catch (err) {
      setError(err.message || 'That time could not be booked. Try another.');
      load();
    } finally {
      setBooking(null);
    }
  }

  if (!requestId) return <Navigate to="/candidate" replace />;

  // Group by day so a long list stays readable.
  const byDay = slots.reduce((acc, s) => {
    const key = DateTime.fromISO(s.startUtc, { zone }).toFormat('cccc, LLL dd');
    (acc[key] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      <button
        onClick={() => navigate('/candidate')}
        className="text-xs font-semibold text-slate-500 hover:text-purple-700 flex items-center gap-1.5 mb-3"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to my interviews
      </button>

      <div className="card p-6 bg-gradient-to-r from-purple-50 via-white to-sky-50/50 border border-sky-100 shadow-sm mb-6">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center shadow-sm">
            <CalendarCheck className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-purple-800 bg-purple-100/70 px-2.5 py-0.5 rounded-full border border-purple-200">
              {mode === 'reschedule' ? 'Reschedule' : 'Choose a Time'}
            </span>
            <h1 className="text-2xl font-extrabold text-slate-900 mt-1">
              {mode === 'reschedule' ? 'Move Your Interview' : 'Pick an Available Time'}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {mode === 'reschedule'
                ? 'These are the times your interviewer is still free. Picking one moves the interview straight away.'
                : 'None of the times you offered could be used. These are the times we can offer instead.'}
            </p>
          </div>
        </div>
      </div>

      {success && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{success}</span>
        </div>
      )}
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center gap-2 animate-fade-in">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {request && (
        <div className="card p-4 bg-white border border-sky-100 shadow-sm mb-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-sm font-extrabold text-slate-900">{request.roundName}</span>
          <span className="chip chip-blue">{request.interviewType}</span>
          <span className="chip border-slate-200 bg-slate-100 text-slate-700">
            {request.durationMinutes} min
          </span>
          {interviewer && (
            <span className="text-xs text-slate-600 font-medium flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-purple-600" />
              With <strong className="text-slate-900">{interviewer.name}</strong>
              {interviewer.title ? ` · ${interviewer.title}` : ''}
            </span>
          )}
          <span className="text-[11px] text-slate-400 ml-auto">Times shown in {zone}</span>
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center">
          <div className="h-8 w-8 rounded-full border-4 border-purple-600 border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-xs font-bold text-slate-700">Finding available times...</p>
        </div>
      ) : slots.length === 0 ? (
        <div className="card p-12 text-center bg-white border border-sky-100">
          <Clock className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-900">No times available right now</p>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Your recruiter has been notified and will be in touch.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(byDay).map(([label, daySlots]) => (
            <div key={label} className="card p-5 bg-white border border-sky-100 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-purple-600" />
                {label}
                <span className="chip border-slate-200 bg-slate-100 text-slate-600 ml-1">
                  {daySlots.length} option{daySlots.length === 1 ? '' : 's'}
                </span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {daySlots.map((s) => {
                  const start = DateTime.fromISO(s.startUtc, { zone });
                  const end = DateTime.fromISO(s.endUtc, { zone });
                  const busy = booking === s.startUtc;
                  return (
                    <button
                      key={s.startUtc}
                      onClick={() => choose(s)}
                      disabled={Boolean(booking)}
                      className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800
                                 hover:border-purple-400 hover:bg-purple-50 hover:text-purple-800
                                 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-xs"
                      title={`Book ${start.toFormat('HH:mm')} – ${end.toFormat('HH:mm')}`}
                    >
                      {busy ? 'Booking...' : `${start.toFormat('HH:mm')} – ${end.toFormat('HH:mm')}`}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-slate-500 text-center">
            Picking a time books it immediately — no further approval is needed.
          </p>
        </div>
      )}
    </div>
  );
}
