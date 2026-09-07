import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import FeedbackModal from './FeedbackModal.jsx';
import {
  Users,
  Calendar,
  Clock,
  Video,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Sparkles,
  AlertTriangle,
  RefreshCw,
  Award,
  BarChart3,
  X,
} from 'lucide-react';
import { DateTime } from 'luxon';

/** Interview states where the round is over, so a response is meaningless. */
const FINISHED = ['COMPLETED', 'CANCELLED', 'NO_SHOW'];
/** States where the backend will accept feedback. */
const FEEDBACK_STATES = ['IN_PROGRESS', 'COMPLETED', 'NO_SHOW'];

export default function InterviewerAssignments() {
  const { user } = useAuth();
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedInterviewForFeedback, setSelectedInterviewForFeedback] = useState(null);
  const [declineModalId, setDeclineModalId] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [actionSuccess, setActionSuccess] = useState(null);
  const [latestAiFeedback, setLatestAiFeedback] = useState(null);
  const [workload, setWorkload] = useState(null);
  const [offers, setOffers] = useState([]);
  const [offerBusy, setOfferBusy] = useState(null);
  const [declineOfferId, setDeclineOfferId] = useState(null);
  const [offerDeclineReason, setOfferDeclineReason] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    loadAssignments();
  }, []);

  async function loadAssignments() {
    setLoading(true);
    try {
      // The interviewer-scoped endpoint also returns `mySeat`, which carries
      // this person's own response status, match score and feedback state -
      // that is what the action buttons below key off.
      const isInterviewer = user?.role === 'INTERVIEWER';
      const [data, load] = await Promise.all([
        isInterviewer ? api.get('/interviewers/me/interviews') : api.get('/interviews?take=20'),
        isInterviewer ? api.get('/interviewers/me/workload').catch(() => null) : Promise.resolve(null),
      ]);
      setInterviews(data || []);
      setWorkload(load);
      setOffers(isInterviewer ? (await api.get('/offers/mine').catch(() => [])) || [] : []);
    } catch (err) {
      console.error('Failed to load assignments:', err);
    } finally {
      setLoading(false);
    }
  }

  async function acceptOffer(offerId, slot) {
    setOfferBusy(offerId);
    try {
      await api.postOnce(`/offers/${offerId}/accept`, { startUtc: slot.startUtc, endUtc: slot.endUtc });
      setActionSuccess(`Booked for ${slot.label}. It is on your calendar now.`);
      loadAssignments();
    } catch (err) {
      alert(err.message || 'Could not accept that time');
    } finally {
      setOfferBusy(null);
    }
  }

  async function declineOffer(e) {
    e.preventDefault();
    if (!declineOfferId || offerDeclineReason.trim().length < 3) return;
    setOfferBusy(declineOfferId);
    try {
      await api.postOnce(`/offers/${declineOfferId}/decline`, { reason: offerDeclineReason.trim() });
      setActionSuccess('Declined. The request has moved on to another interviewer.');
      setDeclineOfferId(null);
      setOfferDeclineReason('');
      loadAssignments();
    } catch (err) {
      alert(err.message || 'Could not decline');
    } finally {
      setOfferBusy(null);
    }
  }

  async function handleAccept(interviewId) {
    try {
      await api.post(`/interviews/${interviewId}/accept`);
      setActionSuccess('Assignment accepted! Added to your schedule.');
      loadAssignments();
    } catch (err) {
      alert(err.message || 'Failed to accept assignment');
    }
  }

  async function handleDecline(e) {
    e.preventDefault();
    if (!declineModalId || !declineReason.trim()) return;
    try {
      await api.post(`/interviews/${declineModalId}/decline-assignment`, {
        reason: declineReason,
      });
      setActionSuccess('Assignment declined. The Control Tower has been notified to re-match the panel.');
      setDeclineModalId(null);
      setDeclineReason('');
      loadAssignments();
    } catch (err) {
      alert(err.message || 'Failed to decline assignment');
    }
  }

  // Categorize interviews
  const needsFeedback = interviews.filter(
    (iv) => FEEDBACK_STATES.includes(iv.status) && !iv.mySeat?.hasSubmittedFeedback
  );
  const upcoming = interviews.filter(
    (iv) => !FINISHED.includes(iv.status) && !needsFeedback.some((n) => n.id === iv.id)
  );
  const completed = interviews.filter(
    (iv) => FINISHED.includes(iv.status) && !needsFeedback.some((n) => n.id === iv.id)
  );

  const displayedInterviews =
    activeTab === 'needsFeedback'
      ? needsFeedback
      : activeTab === 'upcoming'
      ? upcoming
      : activeTab === 'completed'
      ? completed
      : interviews;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 animate-fade-in">
      {/* Top Banner */}
      <div className="card p-5 bg-white border border-gray-200 shadow-2xs mb-6 rounded-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">
              {user?.name?.charAt(0) || 'A'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900">
                  Panel Assignments
                </h1>
                <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                  {user?.name || 'Interviewer'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Timezone: {user?.timezone || 'UTC'} • Track upcoming rounds and submit structured interview evaluations.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <a
              href="/calendar"
              className="px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-2xs flex items-center gap-1.5 transition"
            >
              <Calendar className="h-3.5 w-3.5 text-indigo-600" /> View Calendar
            </a>
            <button
              onClick={loadAssignments}
              className="px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-2xs flex items-center gap-1.5 transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-gray-500 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {actionSuccess && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* AI Feedback Analysis & Next Round Propagation Toast */}
      {latestAiFeedback && (
        <div className="mb-6 p-5 rounded-2xl bg-gradient-to-br from-purple-50 via-indigo-50/50 to-white border border-purple-200 text-xs text-purple-900 shadow-md animate-fade-in relative">
          <button
            onClick={() => setLatestAiFeedback(null)}
            className="absolute top-3.5 right-3.5 text-purple-400 hover:text-purple-700 p-1 rounded-md hover:bg-purple-100/60 transition"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 font-extrabold mb-2 text-purple-950 text-sm">
            <Sparkles className="h-4 w-4 text-purple-600" />
            AI Feedback Analysis & Adaptive Next-Round Propagation Complete
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-white/80 p-3.5 rounded-xl border border-purple-100 mb-2">
            <div>
              <span className="font-bold text-slate-700 block mb-1">Identified Candidate Strengths:</span>
              <div className="flex flex-wrap gap-1.5">
                {(latestAiFeedback.analysis?.strengths || []).map((s, idx) => (
                  <span key={idx} className="chip chip-green text-[10px] font-semibold">
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <span className="font-bold text-slate-700 block mb-1">Detected Skill Gaps:</span>
              <div className="flex flex-wrap gap-1.5">
                {(latestAiFeedback.analysis?.skill_gaps || []).map((g, idx) => (
                  <span key={idx} className="chip chip-amber text-[10px] font-semibold">
                    {g}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-purple-800">
            <strong>Summary:</strong> {latestAiFeedback.analysis?.summary || 'Analysis recorded.'}
          </p>
          {latestAiFeedback.propagation?.applied && (
            <div className="mt-2 text-[11px] text-emerald-800 font-bold bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>Next round updated! Skill gaps were automatically injected as focus topics for subsequent interview rounds.</span>
            </div>
          )}
        </div>
      )}

      {/* Action Required Callout if feedback is pending */}
      {needsFeedback.length > 0 && activeTab !== 'needsFeedback' && (
        <div className="card p-4 bg-amber-50/90 border border-amber-200 shadow-sm mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-100 text-amber-800 shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-amber-950">
                Action Required: {needsFeedback.length} Completed Interview{needsFeedback.length > 1 ? 's' : ''} Awaiting Your Evaluation
              </h3>
              <p className="text-[11px] text-amber-800 mt-0.5">
                The interview has concluded. Submitting your feedback allows our AI to detect strengths & gaps, automatically tuning next-round focus topics.
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveTab('needsFeedback')}
            className="btn-primary text-xs py-1.5 px-3.5 bg-amber-600 hover:bg-amber-700 text-white shrink-0 self-start sm:self-auto flex items-center gap-1.5 shadow-xs font-bold"
          >
            Review & Submit Feedback ({needsFeedback.length})
          </button>
        </div>
      )}

      {/* Workload / schedule load */}
      {workload && (
        <div className="card p-4 bg-white border border-sky-100 shadow-sm mb-6">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4 text-brand-600" />
              My Workload
            </span>

            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-slate-600 font-medium">
                  {workload.upcomingCount} upcoming / {workload.maxPerWeek} per week
                </span>
                <span
                  className={`font-bold ${
                    workload.level === 'OVERLOADED'
                      ? 'text-rose-700'
                      : workload.level === 'BUSY'
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                  }`}
                >
                  {workload.utilizationPercent}% · {workload.level}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    workload.level === 'OVERLOADED'
                      ? 'bg-rose-500'
                      : workload.level === 'BUSY'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, workload.utilizationPercent ?? 0)}%` }}
                />
              </div>
            </div>

            <span className="text-[11px] text-slate-500">
              Busiest day: <strong className="text-slate-800">{workload.busiestDayCount ?? 0}</strong> of{' '}
              {workload.maxPerDay} max
            </span>
          </div>
        </div>
      )}

      {/* Category Tabs */}
      <div className="flex items-center gap-2 border-b border-sky-100 pb-3 mb-5 overflow-x-auto">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 ${
            activeTab === 'all'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          All Assignments
          <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeTab === 'all' ? 'bg-purple-800 text-white' : 'bg-slate-200 text-slate-700'}`}>
            {interviews.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('needsFeedback')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 ${
            activeTab === 'needsFeedback'
              ? 'bg-amber-600 text-white shadow-xs'
              : needsFeedback.length > 0
              ? 'text-amber-900 bg-amber-100/80 hover:bg-amber-100 border border-amber-300 font-extrabold'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
          Pending Feedback
          <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeTab === 'needsFeedback' ? 'bg-amber-800 text-white' : 'bg-amber-200 text-amber-900 font-extrabold'}`}>
            {needsFeedback.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('upcoming')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 ${
            activeTab === 'upcoming'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Clock className="h-3.5 w-3.5" />
          Upcoming
          <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeTab === 'upcoming' ? 'bg-purple-800 text-white' : 'bg-slate-200 text-slate-700'}`}>
            {upcoming.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('completed')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 ${
            activeTab === 'completed'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Past & Completed
          <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeTab === 'completed' ? 'bg-purple-800 text-white' : 'bg-slate-200 text-slate-700'}`}>
            {completed.length}
          </span>
        </button>
      </div>

      {/* Offers - times a candidate proposed that you never declared free */}
      {offers.length > 0 && (
        <div className="card p-5 bg-amber-50/50 border border-amber-200 shadow-sm mb-6">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 mb-1">
            <Clock className="h-5 w-5 text-amber-600" />
            Time Requests Awaiting You ({offers.length})
          </h2>
          <p className="text-xs text-slate-600 mb-4">
            A candidate proposed these times and nobody had declared them free. Pick one to take the
            interview, or decline and it passes to the next interviewer.
          </p>

          <div className="space-y-3">
            {offers.map((o) => (
              <div key={o.id} className="p-4 rounded-xl bg-white border border-amber-200">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="font-extrabold text-sm text-slate-900">{o.round?.name}</span>
                  <span className="chip chip-blue">{o.round?.type}</span>
                  <span className="chip border-slate-200 bg-slate-100 text-slate-700">
                    {o.round?.durationMinutes} min
                  </span>
                  <span className="chip chip-purple">Skill match {Math.round(o.matchScore)}%</span>
                  <span className="chip chip-amber ml-auto font-bold">
                    {o.hoursLeft}h to respond
                  </span>
                </div>

                <p className="text-xs text-slate-600 font-medium mb-3">
                  {o.round?.candidateName} &middot; {o.round?.jobTitle}
                </p>

                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
                  Pick a time that works
                </span>
                <div className="flex flex-wrap gap-2 mb-3">
                  {(o.slots || []).map((slot) => (
                    <button
                      key={slot.startUtc}
                      onClick={() => acceptOffer(o.id, slot)}
                      disabled={Boolean(offerBusy)}
                      className="px-3.5 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-800
                                 hover:bg-emerald-100 hover:border-emerald-400 disabled:opacity-40 transition shadow-xs"
                    >
                      {offerBusy === o.id ? 'Booking...' : slot.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setDeclineOfferId(o.id)}
                  disabled={Boolean(offerBusy)}
                  className="text-xs font-bold text-rose-600 hover:underline flex items-center gap-1.5"
                >
                  <XCircle className="h-3.5 w-3.5" /> None of these work
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assignments List */}
      <div className="space-y-4">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Users className="h-5 w-5 text-purple-600" />
          {activeTab === 'needsFeedback'
            ? `Interviews Awaiting Your Feedback (${needsFeedback.length})`
            : activeTab === 'upcoming'
            ? `Upcoming Panel Appointments (${upcoming.length})`
            : activeTab === 'completed'
            ? `Past & Concluded Interviews (${completed.length})`
            : `All Panel Assignments (${interviews.length})`}
        </h2>

        {displayedInterviews.length === 0 && !loading && (
          <div className="card p-12 text-center bg-white border border-sky-100 text-xs text-slate-400">
            {activeTab === 'needsFeedback'
              ? 'No pending feedback evaluations. You are all caught up!'
              : activeTab === 'upcoming'
              ? 'No upcoming interviews scheduled for your panel right now.'
              : activeTab === 'completed'
              ? 'No past interviews recorded yet.'
              : 'No interviews currently assigned to your panel.'}
          </div>
        )}

        {displayedInterviews.map((iv) => {
          const start = DateTime.fromISO(iv.startUtc, { zone: user?.timezone || 'UTC' });
          const end = DateTime.fromISO(iv.endUtc, { zone: user?.timezone || 'UTC' });
          const candidate = iv.candidate?.name || 'Candidate';
          const job = iv.job?.title || 'Role';

          // `mySeat` comes from the interviewer-scoped endpoint. When a recruiter
          // views this page there is no seat, so fall back to hiding the actions.
          const seat = iv.mySeat || null;
          const seatStatus = seat?.responseStatus ?? null;
          const matchScore = seat?.matchScore ?? 0;
          const hasFeedback = seat?.hasSubmittedFeedback ?? false;

          const canRespond = seatStatus === 'PENDING' && !FINISHED.includes(iv.status);
          // The backend gates joining with 425 until the window opens; mirror it.
          const canJoin = Boolean(iv.isJoinable);
          const canGiveFeedback = FEEDBACK_STATES.includes(iv.status) && !hasFeedback;

          return (
            <div
              key={iv.id}
              className={`card p-5 bg-white border shadow-sm transition ${
                canGiveFeedback
                  ? 'border-amber-300 ring-1 ring-amber-200/50 hover:border-amber-400'
                  : 'border-sky-100 hover:border-sky-200'
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                {/* Info Left */}
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-extrabold text-brand-700 bg-sky-50 px-2.5 py-0.5 rounded border border-sky-200">
                      {iv.round?.name || 'Interview'}
                    </span>
                    <span className="chip chip-blue">{iv.round?.type}</span>
                    <span className={`chip border-slate-200 ${iv.status === 'COMPLETED' ? 'bg-slate-100 text-slate-700' : 'bg-purple-50 text-purple-700'}`}>
                      {iv.status}
                    </span>

                    {/* Feedback Status */}
                    {canGiveFeedback && (
                      <span className="chip bg-amber-100 text-amber-900 border-amber-300 font-extrabold flex items-center gap-1 animate-pulse">
                        <AlertTriangle className="h-3 w-3 text-amber-600" />
                        Feedback Pending
                      </span>
                    )}
                    {hasFeedback && (
                      <span className="chip chip-green font-bold flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                        Feedback Submitted
                      </span>
                    )}

                    {/* Interviewer seat response */}
                    {seatStatus === 'ACCEPTED' && (
                      <span className="chip chip-green font-bold">You accepted</span>
                    )}
                    {seatStatus === 'DECLINED' && (
                      <span className="chip chip-red font-bold">You declined</span>
                    )}
                    {seatStatus === 'PENDING' && (
                      <span className="chip chip-amber font-bold">Awaiting your response</span>
                    )}

                    {matchScore > 0 && (
                      <span
                        className="chip chip-purple"
                        title="How well your skills matched this round's requirements"
                      >
                        Match {Math.round(matchScore)}%
                      </span>
                    )}
                  </div>

                  <h3 className="text-base font-bold text-slate-900">
                    Candidate: {candidate} • <span className="text-slate-500 font-normal">{job}</span>
                  </h3>

                  <div className="mt-2 flex items-center gap-4 text-xs text-slate-600 font-medium">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-brand-600" />
                      {start.toFormat('cccc, LLL dd, yyyy')}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-brand-600" />
                      {start.toFormat('hh:mm a')} – {end.toFormat('hh:mm a')} ({user?.timezone || 'IST'})
                    </span>
                  </div>

                  {/* Summary of feedback if submitted */}
                  {hasFeedback && Array.isArray(iv.feedback) && iv.feedback.length > 0 && (
                    <div className="mt-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-[11px] text-slate-700 flex flex-wrap items-center gap-3">
                      <span>Overall Rating: <strong className="text-slate-900">{iv.feedback[0].overallRating}/5</strong></span>
                      <span>•</span>
                      <span>Recommendation: <strong className="text-brand-700">{iv.feedback[0].recommendation}</strong></span>
                      {iv.feedback[0].aiAnalysis?.strengths?.length > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-emerald-700">Strengths: {iv.feedback[0].aiAnalysis.strengths.slice(0, 3).join(', ')}</span>
                        </>
                      )}
                      {iv.feedback[0].aiAnalysis?.skill_gaps?.length > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-amber-800 font-semibold">Gaps: {iv.feedback[0].aiAnalysis.skill_gaps.slice(0, 2).join(', ')}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions Right */}
                <div className="flex items-center gap-2 flex-wrap">
                  {canJoin ? (
                    <a
                      href={iv.meeting?.joinUrl || `/meeting/${iv.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary text-xs py-2 px-3.5 shadow-xs flex items-center gap-1.5"
                    >
                      <Video className="h-3.5 w-3.5" /> Join Google Meet
                    </a>
                  ) : !FINISHED.includes(iv.status) ? (
                    <span
                      className="text-[11px] text-slate-400 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200"
                      title="The room opens 15 minutes before the interview starts"
                    >
                      <Video className="h-3.5 w-3.5" /> Opens 15 min before
                    </span>
                  ) : null}

                  {canGiveFeedback && (
                    <button
                      onClick={() => setSelectedInterviewForFeedback(iv)}
                      className="btn-primary bg-purple-600 hover:bg-purple-700 text-white text-xs py-2 px-4 shadow-sm flex items-center gap-1.5 font-bold"
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> Submit Feedback
                    </button>
                  )}

                  {canRespond && (
                    <>
                      <button
                        onClick={() => handleAccept(iv.id)}
                        className="btn-ghost text-xs py-2 px-3 text-emerald-700 hover:bg-emerald-50 border-emerald-200 flex items-center gap-1"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Accept
                      </button>
                      <button
                        onClick={() => setDeclineModalId(iv.id)}
                        className="btn-ghost text-xs py-2 px-3 text-rose-700 hover:bg-rose-50 border-rose-200 flex items-center gap-1"
                      >
                        <XCircle className="h-3.5 w-3.5 text-rose-600" /> Decline
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Decline Reason Modal */}
      {declineModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-sky-100 animate-fade-in">
            <h3 className="text-base font-bold text-slate-900 mb-2">Decline Panel Assignment</h3>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Declining this assignment will immediately trigger the <strong>Control Tower</strong> self-healing engine to evaluate available substitute panelists and heal the schedule.
            </p>

            <form onSubmit={handleDecline} className="space-y-4">
              <textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="e.g. Unforeseen production incident oncall duty during this hour."
                rows={3}
                className="input text-xs resize-none"
                required
              />

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeclineModalId(null)}
                  className="btn-ghost text-xs py-2 px-3"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-danger text-xs py-2 px-4 shadow-sm"
                >
                  Decline & Trigger Re-matching
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Feedback Submission Modal */}
      <FeedbackModal
        isOpen={Boolean(selectedInterviewForFeedback)}
        interview={selectedInterviewForFeedback}
        onClose={() => setSelectedInterviewForFeedback(null)}
        onSuccess={(result) => {
          setActionSuccess('Feedback submitted successfully! AI analysis extracted candidate strengths and skill gaps.');
          if (result?.analysis) {
            setLatestAiFeedback(result);
          }
          loadAssignments();
        }}
      />

      {/* Declining hands the round to the next-ranked interviewer. */}
      {declineOfferId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md card p-6 bg-white border border-sky-100 shadow-2xl animate-fade-in">
            <h3 className="text-base font-bold text-slate-900 mb-1">None of these times work?</h3>
            <p className="text-xs text-slate-600 mb-4">
              The request passes to the next best-matched interviewer. If nobody can take it, the
              candidate is asked to pick from your available times instead.
            </p>
            <form onSubmit={declineOffer}>
              <label className="label text-[10px]">Reason</label>
              <textarea
                value={offerDeclineReason}
                onChange={(e) => setOfferDeclineReason(e.target.value)}
                rows={3}
                required
                minLength={3}
                placeholder="e.g. travelling that week"
                className="input text-xs resize-none"
              />
              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => { setDeclineOfferId(null); setOfferDeclineReason(''); }}
                  className="btn-secondary text-xs py-2 px-4"
                >
                  Go back
                </button>
                <button
                  type="submit"
                  disabled={Boolean(offerBusy) || offerDeclineReason.trim().length < 3}
                  className="btn-danger text-xs py-2 px-4 font-bold"
                >
                  {offerBusy ? 'Declining...' : 'Decline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
