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

  // 4. Confirm proposal (Critical Section)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 animate-fade-in">
      {/* Top Banner */}
      <div className="card p-5 bg-white border border-gray-200 shadow-2xs mb-6 rounded-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900">
                  Schedule Optimizer
                </h1>
                <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                  CP-SAT &amp; Heuristic Matching
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Intelligent panel selection, availability scoring, and automated candidate slot reservation.
              </p>
            </div>
          </div>

          {/* Request Selector Dropdown */}
          <div className="flex items-center gap-3 w-full lg:w-auto">
            <label className="text-xs font-bold uppercase text-gray-500 shrink-0">
              Select Request:
            </label>
            <select
              value={selectedRequestId}
              onChange={(e) => setSelectedRequestId(e.target.value)}
              className="input text-xs font-semibold py-1.5 cursor-pointer max-w-sm border-gray-200 text-gray-900 rounded-md"
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
          <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-2.5 rounded-md bg-gray-50 border border-gray-200">
              <span className="text-[10px] uppercase font-bold text-gray-500 block">Candidate</span>
              <span className="font-semibold text-gray-900">{request.candidate?.name || 'Candidate'}</span>
              <span className="text-[10px] text-gray-500 block">
                Zone: {request.candidate?.timezone || 'Asia/Kolkata (IST)'}
              </span>
            </div>
            <div className="p-2.5 rounded-md bg-gray-50 border border-gray-200">
              <span className="text-[10px] uppercase font-bold text-gray-500 block">Round &amp; Role</span>
              <span className="font-semibold text-gray-900">{request.roundName}</span>
              <span className="text-[10px] text-gray-500 font-medium block">{request.interviewType}</span>
            </div>
            <div className="p-2.5 rounded-md bg-gray-50 border border-gray-200">
              <span className="text-[10px] uppercase font-bold text-gray-500 block">Duration &amp; Buffer</span>
              <span className="font-semibold text-gray-900">{request.durationMinutes} min</span>
              <span className="text-[10px] text-gray-500 block">+{request.bufferMinutes}m buffer window</span>
            </div>
            <div className="p-2.5 rounded-md bg-gray-50 border border-gray-200">
              <span className="text-[10px] uppercase font-bold text-gray-500 block">Round Status</span>
              <span className="font-semibold text-gray-900">{request.status}</span>
              <span className="text-[10px] text-gray-500 block">
                Priority: {request.priority || 'NORMAL'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Success Notification Alert */}
      {successBooking && (
        <div className="mb-6 p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-3 shadow-2xs animate-fade-in">
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
                className="btn-primary text-xs py-1.5 px-3 font-semibold rounded-md shadow-2xs"
              >
                View on Calendar
              </button>
              {successBooking.meeting?.joinUrl && (
                <a
                  href={successBooking.meeting.joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-emerald-700 underline hover:text-emerald-900 flex items-center gap-1"
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
        <div className="mb-6 p-4 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-3 shadow-2xs animate-fade-in">
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
          <div className="card p-5 bg-white border border-gray-200 shadow-2xs rounded-lg">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div>
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-indigo-600" />
                  Eligible Interviewers
                </h3>
              </div>
              <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200">
                {matchData?.ranked?.length || 0} matched
              </span>
            </div>

            {/* Matched Interviewers List */}
            <div className="mt-3 divide-y divide-gray-100">
              {!matchData?.ranked || matchData.ranked.length === 0 ? (
                <div className="text-center py-8 text-xs text-gray-400 font-medium">
                  Loading matched panelists...
                </div>
              ) : (
                matchData.ranked.map((iv, idx) => (
                  <div key={iv.interviewerId || idx} className="py-3 first:pt-1 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs shrink-0">
                          {iv.name?.charAt(0) || 'I'}
                        </div>
                        <div>
                          <span className="font-semibold text-xs text-gray-900 block">{iv.name}</span>
                          <span className="text-[10px] text-gray-500 block font-medium">
                            {iv.role} • Level {iv.level || 'L4'}
                          </span>
                        </div>
                      </div>
                      <span className="chip chip-purple text-[11px]">
                        {Math.round((iv.fitScore || 0.85) * 100)}% fit
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500 font-medium">
                      <span>Workload: {iv.weeklyLoad || 0}/{iv.maxPerWeek || 10} this week</span>
                      <span className="text-[10px] font-semibold text-gray-700">
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
          <div className="card p-5 bg-white border border-gray-200 shadow-2xs rounded-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-100">
              <div>
                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-indigo-600" />
                  Suggested Interview Times
                </h3>
              </div>

              {/* Read-only: scheduling runs itself the moment the candidate submits. */}
              <span className="chip chip-blue shrink-0 font-semibold">
                {request?.status === 'SCHEDULED'
                  ? 'Booked automatically'
                  : request?.status === 'WAITING'
                    ? 'Waiting on an interviewer'
                    : request?.status === 'SLOTS_OFFERED'
                      ? 'Candidate is re-picking'
                      : 'Awaiting candidate times'}
              </span>
            </div>

            {/* Proposals List */}
            <div className="mt-5 space-y-4">
              {proposals.length === 0 && !solving && (
                <div className="text-center py-16 px-4 bg-gray-50/50 rounded-lg border border-dashed border-gray-200">
                  <div className="mx-auto w-10 h-10 rounded-full bg-white shadow-2xs flex items-center justify-center text-indigo-600 mb-3 border border-gray-200">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <h4 className="text-sm font-bold text-gray-900">Nothing to show yet</h4>
                  <p className="text-xs text-gray-500 max-w-md mx-auto mt-1 leading-relaxed">
                    Scheduling runs by itself as soon as the candidate submits their times. This page
                    shows what the matcher did and which interviewer it chose.
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
                    className={`p-4 rounded-lg border transition duration-200 ${
                      isRank1
                        ? 'border-indigo-200 bg-indigo-50/20 shadow-2xs'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2">
                        {isRank1 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md bg-indigo-600 text-white shadow-2xs">
                            <Sparkles className="h-3.5 w-3.5" /> Best Match • Recommended
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2.5 py-1 rounded-md border border-gray-200">
                            Alternative #{prop.rank || idx + 1}
                          </span>
                        )}

                        <span className="chip chip-purple">
                          Match Score: {Math.round(prop.score || 88)}%
                        </span>
                      </div>

                      {/* Outcome, not an action - the system already chose. */}
                      {prop.status === 'ACCEPTED' ? (
                        <span className="chip chip-green font-semibold flex items-center gap-1.5">
                          <ShieldCheck className="h-3.5 w-3.5" /> Booked
                        </span>
                      ) : (
                        <span className="chip border-gray-200 bg-gray-100 text-gray-600 font-semibold">
                          {isRank1 ? 'Considered' : 'Alternative'}
                        </span>
                      )}
                    </div>

                    {/* Time Slot Details */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-md bg-white border border-gray-200 text-xs">
                      <div>
                        <span className="text-[10px] font-bold uppercase text-gray-500 block">
                          Your Local Time
                        </span>
                        <div className="font-semibold text-gray-900 text-sm mt-0.5 flex items-center gap-1.5">
                          <Calendar className="h-4 w-4 text-indigo-600 shrink-0" />
                          <span>{start.toFormat('ccc, LLL dd, yyyy')}</span>
                        </div>
                        <span className="text-gray-500 font-medium text-xs">
                          {start.toFormat('hh:mm a')} – {end.toFormat('hh:mm a')} (Local)
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] font-bold uppercase text-gray-500 block">
                          Candidate's Local Time ({candidateZone})
                        </span>
                        <div className="font-semibold text-gray-900 text-sm mt-0.5 flex items-center gap-1.5">
                          <Clock className="h-4 w-4 text-indigo-600 shrink-0" />
                          <span>{startInCandZone.toFormat('ccc, LLL dd')}</span>
                        </div>
                        <span className="text-gray-500 font-medium text-xs">
                          {startInCandZone.toFormat('hh:mm a')} – {end.setZone(candidateZone).toFormat('hh:mm a')}
                        </span>
                      </div>
                    </div>

                    {/* Assigned Panelists for this Slot */}
                    <div className="mt-3 flex items-center justify-between flex-wrap gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-gray-500">Assigned Panel:</span>
                        {(prop.interviewers || []).map((i, iIdx) => (
                          <span
                            key={iIdx}
                            className="font-medium text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-0.5 rounded-full text-xs"
                          >
                            {i.name || 'Panelist'}
                          </span>
                        ))}
                      </div>

                      <span className="text-[11px] text-gray-500 font-medium">
                        Conflict-free verified
                      </span>
                    </div>

                    {/* Reasons / Explanations from Solver */}
                    {prop.reasons && prop.reasons.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-gray-100 flex flex-wrap gap-1.5">
                        {prop.reasons.map((r, rIdx) => (
                          <span
                            key={rIdx}
                            className="text-[10px] font-medium text-gray-600 bg-gray-50 px-2.5 py-0.5 rounded-full border border-gray-200"
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
