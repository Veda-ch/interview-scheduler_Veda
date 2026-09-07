import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  Calendar,
  Clock,
  Video,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Briefcase,
  User,
  Sliders,
  CalendarClock,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { DateTime } from 'luxon';


export default function CandidatePortal() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [interviews, setInterviews] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [requests, setRequests] = useState([]);
  const [cancelling, setCancelling] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [ivs, props, reqs] = await Promise.all([
        api.get('/candidates/me/interviews').catch(() => []),
        api.get('/candidates/me/proposals').catch(() => []),
        api.get('/interview-requests').catch(() => []),
      ]);
      setInterviews(ivs || []);
      setProposals(props || []);
      setRequests(reqs || []);
    } catch (err) {
      console.error('Failed to load candidate portal:', err);
    } finally {
      setLoading(false);
    }
  }

  async function confirmCancel(e) {
    e.preventDefault();
    if (!cancelling || cancelReason.trim().length < 3) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await api.postOnce(`/interviews/${cancelling.id}/candidate-cancel`, { reason: cancelReason.trim() });
      setCancelling(null);
      setCancelReason('');
      await loadData();
    } catch (err) {
      setCancelError(err.message || 'Could not cancel the interview');
    } finally {
      setCancelBusy(false);
    }
  }

  const upcomingInterview = interviews.find(
    (i) => i.status === 'SCHEDULED' || i.status === 'CONFIRMED'
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Top Banner */}
      <div className="card p-6 bg-gradient-to-r from-sky-50 via-white to-sky-50/60 border border-sky-100 shadow-sm mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-600 text-white flex items-center justify-center font-extrabold text-lg shadow-sm">
              {user?.name?.charAt(0) || 'C'}
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100/70 px-2 py-0.5 rounded-full border border-emerald-200">
                Candidate Portal
              </span>
              <h1 className="text-2xl font-extrabold text-slate-900 mt-1">
                Welcome, {user?.name || 'Candidate'}
              </h1>
              <p className="text-xs text-slate-500">
                Timezone: {user?.timezone || 'Asia/Kolkata (IST)'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/calendar')}
              className="btn-secondary text-xs py-2 px-3.5 flex items-center gap-1.5"
            >
              <Calendar className="h-4 w-4 text-brand-600" /> View My Calendar
            </button>
            {requests.length > 0 && (
              <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-amber-100 text-amber-900 border border-amber-200">
                {requests.length} Interview Requests Active
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Section: Pending Interview Requests with Date Window */}
      {requests.length > 0 && (
        <div className="card p-6 bg-white border border-sky-100 shadow-sm mb-8">
          <h2 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-600" />
            Interview Requests Created by Recruiter ({requests.length})
          </h2>

          <div className="space-y-4">
            {requests.map((req) => {
              const earliest = DateTime.fromISO(req.earliestUtc, { zone: user?.timezone || 'UTC' });
              const latest = DateTime.fromISO(req.latestUtc, { zone: user?.timezone || 'UTC' });
              // One card, four states. The action changes with the state; the
              // chip explains where the round actually is.
              const STATES = {
                PENDING: { chip: 'chip-amber', label: 'Awaiting your time slots' },
                PROPOSED: { chip: 'chip-blue', label: 'Matching your times' },
                WAITING: { chip: 'chip-amber', label: 'Waiting on the interviewer' },
                SLOTS_OFFERED: { chip: 'chip-purple', label: 'Choose from available times' },
                SCHEDULED: { chip: 'chip-green', label: 'Scheduled' },
                CANCELLED: { chip: 'chip-red', label: 'Cancelled' },
                FAILED: { chip: 'chip-red', label: 'Could not be scheduled' },
              };
              const state = STATES[req.status] || { chip: 'chip-blue', label: req.status };

              return (
                <div
                  key={req.id}
                  className="p-4 rounded-xl bg-sky-50/50 border border-sky-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-extrabold text-sm text-slate-900">{req.roundName}</span>
                      <span className="chip chip-blue">{req.interviewType}</span>
                      <span className={`chip ${state.chip}`}>{state.label}</span>
                    </div>

                    <div className="text-xs text-slate-600 font-medium flex items-center gap-2 mt-2">
                      <Clock className="h-4 w-4 text-purple-600 shrink-0" />
                      <span>
                        Interview window:{' '}
                        <strong className="text-slate-900">{earliest.toFormat('ccc, LLL dd')}</strong> –{' '}
                        <strong className="text-slate-900">{latest.toFormat('ccc, LLL dd, yyyy')}</strong>
                      </span>
                    </div>

                    {req.status === 'WAITING' && (
                      <p className="text-[11px] text-amber-700 font-medium mt-1.5">
                        Your times are with an interviewer for confirmation. We will let you know as
                        soon as they respond.
                      </p>
                    )}
                    {req.status === 'FAILED' && req.failureReason && (
                      <p className="text-[11px] text-rose-700 font-medium mt-1.5">{req.failureReason}</p>
                    )}
                  </div>

                  {req.status === 'PENDING' && (
                    <button
                      onClick={() => navigate(`/candidate/availability?requestId=${req.id}`)}
                      className="btn-primary text-xs py-2 px-4 shadow-sm flex items-center gap-1.5 shrink-0 font-bold"
                    >
                      <Calendar className="h-4 w-4" />
                      Provide Available Time Slots
                    </button>
                  )}

                  {req.status === 'SLOTS_OFFERED' && (
                    <button
                      onClick={() => navigate(`/candidate/choose-slot?requestId=${req.id}`)}
                      className="btn-primary text-xs py-2 px-4 shadow-sm flex items-center gap-1.5 shrink-0 font-bold"
                    >
                      <Sparkles className="h-4 w-4" />
                      Choose an Available Time
                    </button>
                  )}

                  {req.status === 'WAITING' && (
                    <span className="chip chip-amber shrink-0 font-bold">Held for you</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Next Upcoming Interview Card (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="card p-6 bg-white border border-sky-100 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-brand-600" />
              Next Scheduled Interview
            </h2>

            {!upcomingInterview ? (
              <div className="py-12 text-center text-xs text-slate-400 bg-sky-50/40 rounded-xl border border-dashed border-sky-100">
                <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                No pending interviews right now.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-gradient-to-tr from-sky-50 to-blue-50/40 border border-sky-200 text-xs">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-extrabold text-sm text-slate-900">
                      {upcomingInterview.round?.name || 'Interview'}
                    </span>
                    <span className="chip chip-green">Confirmed</span>
                  </div>

                  <div className="text-slate-700 font-medium space-y-1">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-brand-600" />
                      <span>
                        {DateTime.fromISO(upcomingInterview.startUtc, { zone: user?.timezone || 'UTC' }).toFormat(
                          'cccc, LLL dd, yyyy'
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-brand-600" />
                      <span>
                        {DateTime.fromISO(upcomingInterview.startUtc, { zone: user?.timezone || 'UTC' }).toFormat(
                          'hh:mm a'
                        )}{' '}
                        –{' '}
                        {DateTime.fromISO(upcomingInterview.endUtc, { zone: user?.timezone || 'UTC' }).toFormat(
                          'hh:mm a'
                        )}{' '}
                        ({user?.timezone || 'IST'})
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-sky-200/60 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500 font-medium">
                      Panel: {upcomingInterview.panel?.map((p) => p.name).join(', ') || 'Assigned Interviewer'}
                    </span>
                    {upcomingInterview.isJoinable ? (
                      <a
                        href={upcomingInterview.meeting?.joinUrl || `/meeting/${upcomingInterview.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary text-xs py-2 px-4 shadow-sm flex items-center gap-1.5"
                      >
                        <Video className="h-4 w-4" /> Join Google Meet
                      </a>
                    ) : (
                      <span
                        className="text-[11px] text-slate-400 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200"
                        title="The room opens 15 minutes before the interview starts"
                      >
                        <Video className="h-4 w-4" /> Room opens 15 min before
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 text-xs pt-1">
                  <button
                    onClick={() =>
                      navigate(
                        `/candidate/choose-slot?requestId=${upcomingInterview.requestId}&mode=reschedule&interviewId=${upcomingInterview.id}`
                      )
                    }
                    className="btn-secondary text-xs py-2 px-3.5 flex items-center gap-1.5 font-bold"
                  >
                    <CalendarClock className="h-3.5 w-3.5 text-purple-600" /> Reschedule
                  </button>
                  <button
                    onClick={() => setCancelling(upcomingInterview)}
                    className="text-rose-600 font-bold hover:underline flex items-center gap-1.5"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Cancel interview
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Quick Links & Preferences (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="card p-6 bg-white border border-sky-100 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Sliders className="h-4 w-4 text-brand-600" />
              Scheduling Controls
            </h3>

            <div
              onClick={() => navigate('/candidate/slots')}
              className="p-3.5 rounded-xl border border-purple-100 bg-purple-50/50 hover:bg-purple-100/60 transition cursor-pointer flex items-center justify-between"
            >
              <div>
                <span className="font-bold text-xs text-purple-950 block">
                  Review & Book Open Slots
                </span>
                <span className="text-[11px] text-purple-700">
                  {proposals.length} optimal slots awaiting your selection
                </span>
              </div>
              <ArrowRight className="h-4 w-4 text-purple-600" />
            </div>

          </div>
        </div>
      </div>


      {/* Cancelling ends the whole round, so it asks for a reason first. */}
      {cancelling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md card p-6 bg-white border border-sky-100 shadow-2xl animate-fade-in">
            <div className="flex items-start gap-3 mb-3">
              <div className="p-2.5 rounded-xl bg-rose-100 text-rose-700 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Cancel this interview?</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  This cancels the whole round, not just this time. Your recruiter and interviewer
                  will both be told. To keep the round and just move it, use Reschedule instead.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 mb-3">
              <strong className="block text-slate-900">{cancelling.round?.name || 'Interview'}</strong>
              {cancelling.localLabel}
            </div>

            {cancelError && (
              <div className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800">
                {cancelError}
              </div>
            )}

            <form onSubmit={confirmCancel}>
              <label className="label text-[10px]">Reason</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                required
                minLength={3}
                placeholder="Let them know why, so the recruiter can follow up."
                className="input text-xs resize-none"
              />
              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => { setCancelling(null); setCancelError(null); }}
                  className="btn-secondary text-xs py-2 px-4"
                >
                  Keep interview
                </button>
                <button
                  type="submit"
                  disabled={cancelBusy || cancelReason.trim().length < 3}
                  className="btn-danger text-xs py-2 px-4 font-bold"
                >
                  {cancelBusy ? 'Cancelling...' : 'Cancel interview'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
