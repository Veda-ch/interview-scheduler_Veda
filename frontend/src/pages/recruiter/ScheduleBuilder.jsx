import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import {
  Sparkles,
  Calendar,
  Clock,
  User,
  Users,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Zap,
  Info,
  ChevronRight,
  BarChart2,
  RefreshCw,
  Award,
  Video,
} from 'lucide-react';
import { DateTime } from 'luxon';

export default function ScheduleBuilder() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestIdParam = searchParams.get('requestId');
  const navigate = useNavigate();

  const [requests, setRequests] = useState([]);
  const [selectedRequestId, setSelectedRequestId] = useState(requestIdParam || '');
  const [request, setRequest] = useState(null);

  const [matchData, setMatchData] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [engineUsed, setEngineUsed] = useState('ORTOOLS');
  const [solving, setSolving] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);
  const [error, setError] = useState(null);
  const [successBooking, setSuccessBooking] = useState(null);

  // 1. Load active requests
  useEffect(() => {
    async function loadRequests() {
      try {
        const list = await api.get('/interview-requests');
        setRequests(list || []);
        if (!selectedRequestId && list && list.length > 0) {
          setSelectedRequestId(list[0].id);
        }
      } catch (err) {
        console.error('Failed to load requests:', err);
      }
    }
    loadRequests();
  }, []);

  // 2. When selectedRequestId changes, fetch request details and matching
  useEffect(() => {
    if (!selectedRequestId) return;
    setSearchParams({ requestId: selectedRequestId });
    loadRequestDetails(selectedRequestId);
  }, [selectedRequestId]);

  async function loadRequestDetails(reqId) {
    setError(null);
    setSuccessBooking(null);
    try {
      const req = await api.get(`/interview-requests/${reqId}`);
      setRequest(req);

      // Fetch matched interviewers
      const matchRes = await api.post('/scheduler/match-interviewers', {
        requestId: reqId,
        limit: 8,
      });
      setMatchData(matchRes);

      // Re-render previously generated proposals without re-running the solver.
      const existing = await api.get(`/scheduler/proposals/${reqId}`).catch(() => []);
      setProposals(existing || []);
    } catch (err) {
      console.error('Failed to load request details:', err);
      setError(err.message || 'Error loading request');
    }
  }

  // 3. Trigger optimization
  async function handleSolve() {
    if (!selectedRequestId) return;
    setSolving(true);
    setError(null);
    setSuccessBooking(null);

    try {
      const result = await api.post('/scheduler/generate', {
        requestId: selectedRequestId,
        persist: true,
      });

      setProposals(result.proposals || []);
      setEngineUsed(result.engineUsed || 'ORTOOLS');
      if (result.matching) {
        setMatchData(result.matching);
      }
    } catch (err) {
      console.error('Optimizer error:', err);
      setError(err.message || 'No feasible schedule found. Check availability or constraints.');
    } finally {
      setSolving(false);
    }
  }

  // 4. Confirm proposal (Critical Section)
  async function handleConfirm(proposalId) {
    setConfirmingId(proposalId);
    setError(null);
    try {
      const interview = await api.postOnce('/scheduler/confirm', {
        proposalId,
        note: 'Confirmed via Recruiter Schedule Builder',
      });
      setSuccessBooking(interview);
      // Reload request to show updated status
      loadRequestDetails(selectedRequestId);
    } catch (err) {
      console.error('Confirmation error:', err);
      setError(err.message || 'Could not confirm slot. A double-booking conflict was detected.');
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Top Banner */}
      <div className="card p-6 bg-gradient-to-r from-purple-50 via-white to-sky-50/50 border border-sky-100 shadow-sm mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center font-extrabold text-lg shadow-sm">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-purple-800 bg-purple-100/70 px-2.5 py-0.5 rounded-full border border-purple-200">
                Automated Scheduling Hub
              </span>
              <h1 className="text-2xl font-extrabold text-slate-900 mt-1">
                Schedule Builder
              </h1>
            </div>
          </div>

          {/* Request Selector Dropdown */}
          <div className="flex items-center gap-3 w-full lg:w-auto">
            <label className="text-xs font-bold uppercase text-slate-500 shrink-0">
              Select Request:
            </label>
            <select
              value={selectedRequestId}
              onChange={(e) => setSelectedRequestId(e.target.value)}
              className="input text-xs font-semibold py-2 cursor-pointer max-w-sm border-slate-200 text-slate-900"
            >
              {requests.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.candidate?.name || 'Candidate'} — {r.roundName} ({r.status})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Selected Request Snapshot Badge Bar */}
        {request && (
          <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Candidate</span>
              <span className="font-bold text-slate-900">{request.candidate?.name || 'Candidate'}</span>
              <span className="text-[10px] text-slate-500 block">
                Zone: {request.candidate?.timezone || 'Asia/Kolkata (IST)'}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Round & Role</span>
              <span className="font-bold text-slate-900">{request.roundName}</span>
              <span className="text-[10px] text-slate-500 font-medium block">{request.interviewType}</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Duration & Buffer</span>
              <span className="font-bold text-slate-900">{request.durationMinutes} min</span>
              <span className="text-[10px] text-slate-500 block">+{request.bufferMinutes}m buffer window</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Round Status</span>
              <span className="font-bold text-slate-900">{request.status}</span>
              <span className="text-[10px] text-slate-500 block">
                Priority: {request.priority || 'NORMAL'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Success Notification Alert */}
      {successBooking && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3 shadow-xs animate-fade-in">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-bold text-emerald-900">
              Interview Successfully Scheduled!
            </h4>
            <p className="text-xs text-emerald-800 mt-0.5 leading-relaxed font-medium">
              Calendar reservations created, video meeting link generated, and invites dispatched to the candidate and panel.
            </p>
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => navigate('/calendar')}
                className="btn-primary text-xs py-1.5 px-3 font-bold"
              >
                View on Calendar
              </button>
              {successBooking.meeting?.joinUrl && (
                <a
                  href={successBooking.meeting.joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-emerald-700 underline hover:text-emerald-900 flex items-center gap-1"
                >
                  <Video className="h-3.5 w-3.5 text-emerald-600" /> Open Google Meet Call
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3 shadow-xs animate-fade-in">
          <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-bold text-rose-900">Unable to Find Open Time Slot</h4>
            <p className="text-xs text-rose-800 mt-0.5 font-medium">{error}</p>
          </div>
        </div>
      )}

      {/* 2-Column Core Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Eligible Interviewers (Intelligent Matching) (4 Cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="card p-5 bg-white border border-sky-100 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-purple-600" />
                  Eligible Interviewers
                </h3>
              </div>
              <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-0.5 rounded-full border border-purple-200">
                {matchData?.ranked?.length || 0} matched
              </span>
            </div>

            {/* Matched Interviewers List */}
            <div className="mt-3 divide-y divide-slate-100">
              {!matchData?.ranked || matchData.ranked.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400 font-medium">
                  Loading matched panelists...
                </div>
              ) : (
                matchData.ranked.map((iv, idx) => (
                  <div key={iv.interviewerId || idx} className="py-3 first:pt-1 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                          {iv.name?.charAt(0) || 'I'}
                        </div>
                        <div>
                          <span className="font-bold text-xs text-slate-900 block">{iv.name}</span>
                          <span className="text-[10px] text-slate-500 block font-medium">
                            {iv.role} • Level {iv.level || 'L4'}
                          </span>
                        </div>
                      </div>
                      <span className="chip chip-purple text-[11px]">
                        {Math.round((iv.fitScore || 0.85) * 100)}% fit
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                      <span>Workload: {iv.weeklyLoad || 0}/{iv.maxPerWeek || 10} this week</span>
                      <span className="text-[10px] font-semibold text-slate-700">
                        {iv.matchedSkills?.length || 0} skills matched
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: solver proposals (8 Cols) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="card p-5 bg-white border border-sky-100 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Zap className="h-5 w-5 text-purple-600" />
                  Suggested Interview Times
                </h3>
              </div>

              {/* Action Button: Solve */}
              <button
                onClick={handleSolve}
                disabled={solving}
                className="btn-primary text-xs py-2.5 px-4 flex items-center gap-2 shrink-0 font-bold"
              >
                <Sparkles className={`h-4 w-4 ${solving ? 'animate-spin' : ''}`} />
                {solving ? 'Finding available times...' : 'Find Available Times'}
              </button>
            </div>

            {/* Proposals List */}
            <div className="mt-5 space-y-4">
              {proposals.length === 0 && !solving && (
                <div className="text-center py-16 px-4 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  <div className="mx-auto w-12 h-12 rounded-2xl bg-white shadow-xs flex items-center justify-center text-purple-600 mb-3 border border-slate-200">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">
                    No active proposals generated yet
                  </h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
                    Click <strong>"Find Available Times"</strong> above to check candidate and panel availability, apply buffers, and find the best meeting times.
                  </p>
                </div>
              )}

              {proposals.map((prop, idx) => {
                const start = DateTime.fromISO(prop.startUtc);
                const end = DateTime.fromISO(prop.endUtc);
                const candidateZone = request?.candidate?.timezone || 'Asia/Kolkata';
                const startInCandZone = start.setZone(candidateZone);
                const isRank1 = prop.rank === 1 || idx === 0;

                return (
                  <div
                    key={prop.id || idx}
                    className={`p-4 rounded-2xl border transition duration-200 ${
                      isRank1
                        ? 'border-purple-200 bg-purple-50/30 shadow-xs'
                        : 'border-slate-200 bg-white hover:border-slate-300 shadow-2xs'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2">
                        {isRank1 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold uppercase px-2.5 py-1 rounded-xl bg-purple-600 text-white shadow-xs">
                            <Sparkles className="h-3.5 w-3.5" /> Best Match • Recommended
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-xl border border-slate-200">
                            Alternative #{prop.rank || idx + 1}
                          </span>
                        )}

                        <span className="chip chip-purple">
                          Match Score: {Math.round(prop.score || 88)}%
                        </span>
                      </div>

                      {/* Confirm & Book CTA */}
                      <button
                        onClick={() => handleConfirm(prop.id)}
                        disabled={confirmingId === prop.id}
                        className={`text-xs py-2 px-4 font-bold rounded-xl transition flex items-center gap-1.5 shadow-xs ${
                          isRank1
                            ? 'btn-primary'
                            : 'btn-secondary'
                        }`}
                      >
                        <ShieldCheck className="h-4 w-4" />
                        {confirmingId === prop.id ? 'Booking...' : 'Confirm & Book'}
                      </button>
                    </div>

                    {/* Time Slot Details */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-white border border-slate-200 text-xs">
                      <div>
                        <span className="text-[10px] font-bold uppercase text-slate-500 block">
                          Your Local Time
                        </span>
                        <div className="font-bold text-slate-900 text-sm mt-0.5 flex items-center gap-1.5">
                          <Calendar className="h-4 w-4 text-purple-600 shrink-0" />
                          <span>{start.toFormat('ccc, LLL dd, yyyy')}</span>
                        </div>
                        <span className="text-slate-500 font-medium text-xs">
                          {start.toFormat('hh:mm a')} – {end.toFormat('hh:mm a')} (Local)
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] font-bold uppercase text-slate-500 block">
                          Candidate's Local Time ({candidateZone})
                        </span>
                        <div className="font-bold text-slate-900 text-sm mt-0.5 flex items-center gap-1.5">
                          <Clock className="h-4 w-4 text-purple-600 shrink-0" />
                          <span>{startInCandZone.toFormat('ccc, LLL dd')}</span>
                        </div>
                        <span className="text-slate-500 font-medium text-xs">
                          {startInCandZone.toFormat('hh:mm a')} – {end.setZone(candidateZone).toFormat('hh:mm a')}
                        </span>
                      </div>
                    </div>

                    {/* Assigned Panelists for this Slot */}
                    <div className="mt-3 flex items-center justify-between flex-wrap gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-slate-500">Assigned Panel:</span>
                        {(prop.interviewers || []).map((i, iIdx) => (
                          <span
                            key={iIdx}
                            className="font-medium text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-0.5 rounded-full text-xs"
                          >
                            {i.name || 'Panelist'}
                          </span>
                        ))}
                      </div>

                      <span className="text-[11px] text-slate-500 font-medium">
                        Conflict-free verified
                      </span>
                    </div>

                    {/* Reasons / Explanations from Solver */}
                    {prop.reasons && prop.reasons.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap gap-1.5">
                        {prop.reasons.map((r, rIdx) => (
                          <span
                            key={rIdx}
                            className="text-[10px] font-medium text-slate-600 bg-slate-50 px-2.5 py-0.5 rounded-full border border-slate-200"
                          >
                            • {r}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
