import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  Sparkles,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  ArrowRight,
  ShieldCheck,
  Video,
} from 'lucide-react';
import { DateTime } from 'luxon';

export default function SlotConfirmation() {
  const { user } = useAuth();
  const [proposals, setProposals] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bookingId, setBookingId] = useState(null);
  const [rescheduleInterviewId, setRescheduleInterviewId] = useState(null);
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [submittingReschedule, setSubmittingReschedule] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadCandidateSlots();
  }, []);

  async function loadCandidateSlots() {
    setLoading(true);
    try {
      const [props, ivs] = await Promise.all([
        api.get('/candidates/me/proposals').catch(() => []),
        api.get('/candidates/me/interviews').catch(() => []),
      ]);
      setProposals(props || []);
      setInterviews(ivs || []);
    } catch (err) {
      console.error('Failed to load slots:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAcceptProposal(proposalId) {
    setBookingId(proposalId);
    setMessage(null);
    setError(null);
    try {
      await api.postOnce('/scheduler/confirm', {
        proposalId,
        note: 'Candidate self-confirmed slot via portal',
      });
      setMessage('Your interview time is locked and confirmed! Calendar event generated.');
      loadCandidateSlots();
    } catch (err) {
      setError(err.message || 'Failed to book slot. It may have expired or clashed.');
    } finally {
      setBookingId(null);
    }
  }

  async function handleRequestReschedule(e) {
    e.preventDefault();
    if (!rescheduleInterviewId || !rescheduleReason.trim()) return;
    setSubmittingReschedule(true);
    try {
      await api.post(`/interviews/${rescheduleInterviewId}/request-reschedule`, {
        note: rescheduleReason,
      });
      setMessage('Reschedule request submitted. The Control Tower is analyzing new slots.');
      setRescheduleInterviewId(null);
      setRescheduleReason('');
      loadCandidateSlots();
    } catch (err) {
      setError(err.message || 'Failed to submit reschedule request');
    } finally {
      setSubmittingReschedule(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Top Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-purple-600" />
          Candidate Self-Service Slot Booking & Rescheduling
        </h1>
        <p className="text-xs text-slate-600 mt-1">
          Bonus Feature 6 • Select your preferred interview time or request rescheduling with 1 click
        </p>
      </div>

      {message && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center gap-2 animate-fade-in">
          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Section 1: Open Slot Proposals */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-brand-600" />
            Proposed Interview Time Options ({proposals.length})
          </h2>
          <span className="text-xs text-slate-500">
            Timezone: <strong>{user?.timezone || 'Local'}</strong>
          </span>
        </div>

        {proposals.length === 0 && !loading && (
          <div className="card p-10 text-center bg-white border border-sky-100">
            <CheckCircle2 className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-500 font-medium">
              No open slot proposals waiting for your confirmation right now.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {proposals.map((prop, idx) => {
            const start = DateTime.fromISO(prop.startUtc, { zone: user?.timezone || 'UTC' });
            const end = DateTime.fromISO(prop.endUtc, { zone: user?.timezone || 'UTC' });
            const isRank1 = prop.rank === 1 || idx === 0;

            return (
              <div
                key={prop.id || idx}
                className={`card p-5 bg-white border transition duration-200 ${
                  isRank1
                    ? 'border-brand-300 shadow-md ring-1 ring-brand-200'
                    : 'border-sky-100 hover:border-sky-200 shadow-sm'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span
                    className={`text-xs font-semibold px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 ${
                      isRank1
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {isRank1 ? (
                      <>
                        <Sparkles className="h-3 w-3" /> Recommended Slot
                      </>
                    ) : (
                      `Option #${prop.rank || idx + 1}`
                    )}
                  </span>
                  <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                    Match {Math.round(prop.score || 90)}%
                  </span>
                </div>

                <h3 className="font-bold text-sm text-slate-900">
                  {prop.roundName || 'Technical Interview'} — {prop.jobTitle}
                </h3>

                {/* Time Display */}
                <div className="my-3 p-3 rounded-xl bg-sky-50/60 border border-sky-100 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 text-sm">
                    <Calendar className="h-4 w-4 text-brand-600" />
                    <span>{start.toFormat('cccc, LLL dd, yyyy')}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-600 font-medium mt-1">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    <span>
                      {start.toFormat('hh:mm a')} – {end.toFormat('hh:mm a')} ({user?.timezone || 'Local'})
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-[11px] text-slate-400">
                    Duration: {prop.durationMinutes || 60}m
                  </span>
                  <button
                    onClick={() => handleAcceptProposal(prop.id)}
                    disabled={bookingId === prop.id}
                    className="btn-primary text-xs py-2 px-4 shadow-sm"
                  >
                    {bookingId === prop.id ? 'Confirming...' : 'Accept This Slot'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 2: Confirmed Interviews (with Reschedule Option) */}
      <div>
        <h2 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          My Confirmed Interviews ({interviews.length})
        </h2>

        <div className="space-y-3">
          {interviews.length === 0 && !loading && (
            <div className="card p-8 text-center bg-white border border-sky-100 text-xs text-slate-400">
              No confirmed interviews yet.
            </div>
          )}

          {interviews.map((iv) => {
            const start = DateTime.fromISO(iv.startUtc, { zone: user?.timezone || 'UTC' });
            const end = DateTime.fromISO(iv.endUtc, { zone: user?.timezone || 'UTC' });

            return (
              <div
                key={iv.id}
                className="card p-4 bg-white border border-sky-100 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900">
                      {iv.round?.name || 'Interview'}
                    </span>
                    <span className="chip chip-green">Confirmed</span>
                  </div>
                  <div className="text-slate-600 mt-1 font-medium">
                    {start.toFormat('ccc, LLL dd, yyyy')} • {start.toFormat('hh:mm a')} – {end.toFormat('hh:mm a')} ({user?.timezone || 'Local'})
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={iv.meeting?.joinUrl || `/meeting/${iv.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5"
                  >
                    <Video className="h-3.5 w-3.5" /> Join Google Meet
                  </a>
                  <button
                    onClick={() => setRescheduleInterviewId(iv.id)}
                    className="btn-ghost text-xs py-1.5 px-3 text-rose-700 hover:bg-rose-50 border-rose-100"
                  >
                    Request Reschedule
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reschedule Modal */}
      {rescheduleInterviewId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-sky-100 animate-fade-in">
            <h3 className="text-base font-bold text-slate-900 mb-2">Request Reschedule</h3>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Please state why this slot no longer works. The Control Tower will automatically search for optimal alternatives that fit your updated availability.
            </p>

            <form onSubmit={handleRequestReschedule} className="space-y-4">
              <textarea
                value={rescheduleReason}
                onChange={(e) => setRescheduleReason(e.target.value)}
                placeholder="e.g. Schedule conflict with prior exam; can attend any time after 3pm instead."
                rows={3}
                className="input text-xs resize-none"
                required
              />

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRescheduleInterviewId(null)}
                  className="btn-ghost text-xs py-2 px-3"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReschedule}
                  className="btn-danger text-xs py-2 px-4 shadow-sm"
                >
                  {submittingReschedule ? 'Submitting...' : 'Submit Reschedule Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
