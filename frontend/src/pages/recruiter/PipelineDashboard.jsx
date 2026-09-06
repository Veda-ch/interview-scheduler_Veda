import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import RequestModal from './RequestModal.jsx';
import {
  Layers,
  Plus,
  Calendar,
  Sparkles,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Video,
  User,
  ExternalLink,
  RefreshCw,
  Search,
  Filter,
  Users,
  UserCheck,
  X,
} from 'lucide-react';
import { DateTime } from 'luxon';

export default function PipelineDashboard() {
  const [requests, setRequests] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [pulledCandidates, setPulledCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPullModalOpen, setIsPullModalOpen] = useState(false);
  const [selectedApplicationId, setSelectedApplicationId] = useState(null);
  const [activeTab, setActiveTab] = useState('requests');
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    loadDashboardData();
  }, []);

  async function loadDashboardData() {
    setLoading(true);
    try {
      const [reqData, intData, incData, candData] = await Promise.all([
        api.get('/interview-requests').catch(() => []),
        api.get('/interviews?take=30').catch(() => []),
        api.get('/control-tower/incidents?status=OPEN').catch(() => []),
        api.get('/candidates?take=50').catch(() => []),
      ]);
      setRequests(reqData || []);
      setInterviews(intData || []);
      setIncidents(incData || []);
      setPulledCandidates(candData?.items || candData || []);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }

  // Filtered requests
  const filteredRequests = requests.filter((r) => {
    const term = searchTerm.toLowerCase();
    return (
      r.roundName?.toLowerCase().includes(term) ||
      r.candidate?.name?.toLowerCase().includes(term) ||
      r.job?.title?.toLowerCase().includes(term) ||
      r.interviewType?.toLowerCase().includes(term)
    );
  });

  function getStatusChip(status) {
    switch (status) {
      case 'PENDING':
        return <span className="chip chip-amber font-semibold">Awaiting Candidate Slots</span>;
      case 'PROPOSED':
        return <span className="chip chip-purple font-bold">Slots Submitted (Ready for Matching)</span>;
      case 'SCHEDULED':
      case 'CONFIRMED':
        return <span className="chip chip-green font-bold">Scheduled & Booked</span>;
      case 'COMPLETED':
        return <span className="chip chip-blue">Completed</span>;
      case 'CANCELLED':
      case 'FAILED':
        return <span className="chip chip-red">{status}</span>;
      default:
        return <span className="chip border-slate-200 bg-slate-100 text-slate-700">{status}</span>;
    }
  }

  function getTypeBadge(type) {
    switch (type) {
      case 'TECHNICAL':
      case 'CODING':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'SYSTEM_DESIGN':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'MANAGERIAL':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'HR':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Interview Coordination Control Tower
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Automated multi-round pipeline, smart slot optimization & self-healing incident monitor
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadDashboardData}
            className="btn-ghost text-xs py-2 px-3 text-slate-600"
            title="Refresh Data"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setIsPullModalOpen(true)}
            className="btn-secondary text-xs py-2.5 px-4 shadow-xs flex items-center gap-2 border-sky-200 text-sky-900 bg-sky-50 hover:bg-sky-100 font-bold"
          >
            <UserCheck className="h-4 w-4 text-sky-600" /> Pull Candidates ({pulledCandidates.length})
          </button>
          <button
            onClick={() => {
              setSelectedApplicationId(null);
              setIsModalOpen(true);
            }}
            className="btn-primary text-xs py-2.5 px-4 shadow-md shadow-brand-500/20 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" /> Create Interview Request
          </button>
        </div>
      </div>

      {/* KPI Cards (High Contrast & Clear) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Card 1: Active Requests */}
        <div className="card p-5 bg-white border border-sky-100/90 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Pipeline Requests
            </span>
            <div className="p-2.5 rounded-xl bg-sky-100 text-brand-700">
              <Layers className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">{requests.length}</span>
            <span className="text-xs font-semibold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-100">
              {requests.filter((r) => r.status === 'PENDING' || r.status === 'PROPOSED').length} awaiting slots
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2">Active interview round candidates</p>
        </div>

        {/* Card 2: Booked Interviews */}
        <div className="card p-5 bg-white border border-sky-100/90 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Scheduled Interviews
            </span>
            <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">{interviews.length}</span>
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
              Locked in calendar
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2">Guaranteed double-booking protected</p>
        </div>

        {/* Card 3: Control Tower Incidents */}
        <div
          onClick={() => navigate('/control-tower')}
          className="card p-5 bg-white border border-rose-100 shadow-sm cursor-pointer hover:border-rose-200 transition group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-700">
              Control Tower Alerts
            </span>
            <div className="p-2.5 rounded-xl bg-rose-100 text-rose-700 group-hover:scale-105 transition">
              <ShieldAlert className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-rose-900">{incidents.length}</span>
            <span className="text-xs font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
              {incidents.length > 0 ? 'Action Needed' : 'Nominal'}
            </span>
          </div>
          <p className="text-xs text-rose-600 mt-2 flex items-center gap-1 font-medium">
            View self-healing recovery <ArrowRight className="h-3 w-3" />
          </p>
        </div>

        {/* Card 4: Booked interviews (counted from real rows, not estimated) */}
        <div className="card p-5 bg-white border border-sky-100/90 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Booked Interviews
            </span>
            <div className="p-2.5 rounded-xl bg-purple-100 text-purple-700">
              <Sparkles className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">{interviews.length}</span>
            <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-100">
              CP-SAT solver
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {interviews.filter((i) => i.status === 'CONFIRMED').length} confirmed by the candidate
          </p>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="card bg-white border border-sky-100 shadow-sm overflow-hidden">
        {/* Tabs & Search Header */}
        <div className="px-6 py-4 border-b border-sky-100 bg-sky-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('requests')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                activeTab === 'requests'
                  ? 'bg-white text-brand-700 shadow-xs border border-sky-100'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              Interview Requests ({requests.length})
            </button>
            <button
              onClick={() => setActiveTab('interviews')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                activeTab === 'interviews'
                  ? 'bg-white text-brand-700 shadow-xs border border-sky-100'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              Scheduled Interviews ({interviews.length})
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search candidate, job, round..."
              className="input pl-9 py-1.5 text-xs"
            />
          </div>
        </div>

        {/* Tab 1: Requests Table */}
        {activeTab === 'requests' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="th">Candidate & Job</th>
                  <th className="th">Round & Type</th>
                  <th className="th">Duration & Buffer</th>
                  <th className="th">Required Skills</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-slate-400 text-sm">
                      No interview requests match your filter. Click "+ Create Interview Request" to get started!
                    </td>
                  </tr>
                ) : (
                  filteredRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-sky-50/40 transition">
                      <td className="td">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-sky-400 to-brand-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                            {req.candidate?.name?.charAt(0) || 'C'}
                          </div>
                          <div>
                            <span className="font-bold text-slate-900 text-sm block">
                              {req.candidate?.name || 'Candidate'}
                            </span>
                            <span className="text-xs text-slate-500 font-medium">
                              {req.job?.title || 'Engineer'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="td">
                        <div className="space-y-1">
                          <span className="font-semibold text-slate-800 text-xs block">
                            {req.roundName}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${getTypeBadge(
                              req.interviewType
                            )}`}
                          >
                            {req.interviewType}
                          </span>
                        </div>
                      </td>
                      <td className="td">
                        <div className="text-xs text-slate-700 font-medium space-y-0.5">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5 text-sky-600" />
                            <span>{req.durationMinutes} minutes</span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            +{req.bufferMinutes}m buffer • {req.requiredInterviewerCount} panelist(s)
                          </div>
                        </div>
                      </td>
                      <td className="td">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {(req.requiredSkills || []).slice(0, 3).map((s, idx) => (
                            <span
                              key={idx}
                              className="text-[10px] font-semibold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200"
                            >
                              {s.name || s}
                            </span>
                          ))}
                          {(req.requiredSkills || []).length > 3 && (
                            <span className="text-[10px] text-slate-400 self-center">
                              +{req.requiredSkills.length - 3} more
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="td">{getStatusChip(req.status)}</td>
                      <td className="td text-right">
                        {/* Nothing can be scheduled until the candidate has offered
                            times - the solver has no feasible space without them. */}
                        <button
                          onClick={() => navigate(`/builder?requestId=${req.id}`)}
                          disabled={req.status === 'PENDING'}
                          title={
                            req.status === 'PENDING'
                              ? 'Waiting for the candidate to provide their available time slots'
                              : 'Open the schedule builder for this round'
                          }
                          className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 ml-auto shadow-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Schedule Slot</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 2: Scheduled Interviews Table */}
        {activeTab === 'interviews' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="th">Interview & Candidate</th>
                  <th className="th">Scheduled Wall-Clock Time</th>
                  <th className="th">Assigned Panel</th>
                  <th className="th">Meeting Room</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {interviews.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-slate-400 text-sm">
                      No interviews currently confirmed. Generate proposals in Schedule Builder to book!
                    </td>
                  </tr>
                ) : (
                  interviews.map((iv) => {
                    const start = DateTime.fromISO(iv.startUtc);
                    const end = DateTime.fromISO(iv.endUtc);
                    return (
                      <tr key={iv.id} className="hover:bg-sky-50/40 transition">
                        <td className="td">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                              {iv.candidate?.name?.charAt(0) || 'C'}
                            </div>
                            <div>
                              <span className="font-bold text-slate-900 text-sm block">
                                {iv.round?.name || 'Interview'}
                              </span>
                              <span className="text-xs text-slate-500 font-medium">
                                {iv.candidate?.name} •{' '}
                                {iv.job?.title}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="td">
                          <div className="text-xs font-semibold text-slate-800">
                            {start.toFormat('ccc, LLL dd, yyyy')}
                          </div>
                          <div className="text-[11px] text-slate-500 font-medium">
                            {start.toFormat('HH:mm')} – {end.toFormat('HH:mm')} (UTC)
                          </div>
                        </td>
                        <td className="td">
                          <div className="flex items-center gap-1.5">
                            {(iv.panel || []).map((p, idx) => (
                              <span
                                key={idx}
                                className="text-xs font-semibold bg-sky-50 text-brand-800 border border-sky-200 px-2 py-0.5 rounded-md"
                              >
                                {p.name || 'Panelist'}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="td">
                          {iv.meeting?.joinUrl ? (
                            <a
                              href={`/meeting/${iv.id}`}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 bg-sky-50 px-2.5 py-1 rounded-lg border border-sky-200"
                            >
                              <Video className="h-3.5 w-3.5 text-brand-600" />
                              Join Room
                            </a>
                          ) : (
                            <span className="text-xs text-slate-400">Generating...</span>
                          )}
                        </td>
                        <td className="td">{getStatusChip(iv.status)}</td>
                        <td className="td text-right">
                          <button
                            onClick={() => navigate(`/calendar`)}
                            className="btn-ghost text-xs py-1.5 px-3"
                          >
                            View in Calendar
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal for Creating Interview Request */}
      <RequestModal
        isOpen={isModalOpen}
        initialApplicationId={selectedApplicationId}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedApplicationId(null);
        }}
        onSuccess={() => {
          loadDashboardData();
        }}
      />

      {/* Pull Candidates Roster Modal */}
      {isPullModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl overflow-hidden border border-sky-100 flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 border-b border-sky-100 bg-sky-50/70 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-sky-100 text-sky-700 rounded-xl">
                  <Users className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Pulled Candidates Roster</h2>
                  <p className="text-xs text-slate-500">
                    Showing candidates pulled and waiting for interview request assignment
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsPullModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Table Body */}
            <div className="p-6 overflow-y-auto space-y-4">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-600 bg-sky-50 px-4 py-2.5 rounded-xl border border-sky-100">
                <span>
                  Total Candidates Pulled:{' '}
                  <strong className="text-brand-700 font-extrabold">{pulledCandidates.length}</strong>
                </span>
                <span className="text-sky-700 font-semibold bg-sky-100 px-2 py-0.5 rounded-md border border-sky-200">
                  Ready for Interview Request
                </span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Candidate No</th>
                      <th className="py-3 px-4">Candidate Name</th>
                      <th className="py-3 px-4">Role Applied To</th>
                      <th className="py-3 px-4">Required / Key Skills</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pulledCandidates.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-slate-400">
                          No pulled candidates found.
                        </td>
                      </tr>
                    ) : (
                      pulledCandidates.map((c) => {
                        const cNumber = c.candidateNumber || `CND-${(c.id || '').slice(-4).toUpperCase()}`;
                        const app = c.applications?.[0];
                        const jobTitle = app?.jobTitle || c.headline || 'Senior Software Engineer';
                        const skillList = (c.skills || []).map((s) => s.name || s.skill?.name || s).filter(Boolean);

                        return (
                          <tr key={c.id} className="hover:bg-sky-50/50 transition">
                            <td className="py-3 px-4">
                              <span className="font-mono bg-sky-100 text-sky-800 font-bold px-2 py-1 rounded-md text-[11px] border border-sky-200">
                                {cNumber}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-bold text-slate-900">
                              {c.name}
                            </td>
                            <td className="py-3 px-4 font-medium text-slate-700">
                              {jobTitle}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {skillList.slice(0, 4).map((sk, idx) => (
                                  <span
                                    key={idx}
                                    className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border text-[10px] font-semibold border-slate-200"
                                  >
                                    {sk}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                onClick={() => {
                                  setIsPullModalOpen(false);
                                  setSelectedApplicationId(app?.id || null);
                                  setIsModalOpen(true);
                                }}
                                className="btn-primary text-[11px] py-1.5 px-3 shadow-xs inline-flex items-center gap-1"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Create Request
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
