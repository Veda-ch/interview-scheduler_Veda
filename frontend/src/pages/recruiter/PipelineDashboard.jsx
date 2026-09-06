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
        return <span className="chip chip-blue font-semibold">Slots Submitted</span>;
      case 'SCHEDULED':
      case 'CONFIRMED':
        return <span className="chip chip-green font-semibold">Scheduled & Booked</span>;
      case 'COMPLETED':
        return <span className="chip border-slate-200 bg-slate-100 text-slate-700 font-semibold">Completed</span>;
      case 'CANCELLED':
      case 'FAILED':
        return <span className="chip chip-red font-semibold">{status}</span>;
      default:
        return <span className="chip border-slate-200 bg-slate-50 text-slate-700">{status}</span>;
    }
  }

  function getTypeBadge(type) {
    switch (type) {
      case 'TECHNICAL':
      case 'CODING':
        return 'chip chip-blue';
      case 'SYSTEM_DESIGN':
        return 'chip chip-purple';
      case 'MANAGERIAL':
        return 'chip chip-amber';
      case 'HR':
        return 'chip border-slate-200 bg-slate-50 text-slate-700';
      default:
        return 'chip chip-blue';
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Top Banner */}
      <div className="card p-6 bg-gradient-to-r from-purple-50 via-white to-sky-50/50 border border-sky-100 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center font-extrabold text-lg shadow-sm">
              <Layers className="h-6 w-6" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-purple-800 bg-purple-100/70 px-2.5 py-0.5 rounded-full border border-purple-200">
                Slotify Recruiter
              </span>
              <h1 className="text-2xl font-extrabold text-slate-900 mt-1">
                Interview Dashboard
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-start sm:self-auto flex-wrap">
            <button
              onClick={loadDashboardData}
              className="btn-ghost text-xs py-2 px-3 text-slate-600 hover:text-slate-900"
              title="Refresh Data"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button
              onClick={() => setIsPullModalOpen(true)}
              className="btn-secondary text-xs py-2 px-3.5 flex items-center gap-1.5 font-bold"
            >
              <UserCheck className="h-4 w-4 text-purple-600" /> Candidate Directory ({pulledCandidates.length})
            </button>
            <button
              onClick={() => {
                setSelectedApplicationId(null);
                setIsModalOpen(true);
              }}
              className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5 font-bold"
            >
              <Plus className="h-4 w-4" /> Schedule New Round
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Card 1: Active Requests */}
        <div className="card p-5 bg-white border border-sky-100 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Interview Requests
            </span>
            <div className="p-2.5 rounded-2xl bg-purple-50 text-purple-600 border border-purple-100">
              <Layers className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{requests.length}</span>
            <span className="chip chip-amber text-[10px]">
              {requests.filter((r) => r.status === 'PENDING' || r.status === 'PROPOSED').length} awaiting slots
            </span>
          </div>
          <p className="text-xs font-medium text-slate-500 mt-2">Active interview round requests</p>
        </div>

        {/* Card 2: Booked Interviews */}
        <div className="card p-5 bg-white border border-sky-100 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Scheduled Interviews
            </span>
            <div className="p-2.5 rounded-2xl bg-sky-50 text-sky-600 border border-sky-100">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{interviews.length}</span>
            <span className="chip chip-blue text-[10px]">
              On calendar
            </span>
          </div>
          <p className="text-xs font-medium text-slate-500 mt-2">Confirmed conflict-free sessions</p>
        </div>

        {/* Card 3: Control Tower Incidents */}
        <div
          onClick={() => navigate('/control-tower')}
          className="card p-5 bg-white border border-rose-100 hover:border-rose-200 shadow-sm cursor-pointer transition group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Scheduling Alerts
            </span>
            <div className="p-2.5 rounded-2xl bg-rose-50 text-rose-600 border border-rose-100 group-hover:scale-105 transition">
              <ShieldAlert className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{incidents.length}</span>
            <span className={`chip text-[10px] ${incidents.length > 0 ? 'chip-red' : 'chip-green'}`}>
              {incidents.length > 0 ? 'Action Needed' : 'All Clear'}
            </span>
          </div>
          <p className="text-xs text-purple-600 mt-2 flex items-center gap-1 font-semibold group-hover:text-purple-800">
            View schedule resolution <ArrowRight className="h-3 w-3" />
          </p>
        </div>

        {/* Card 4: Confirmed interviews */}
        <div className="card p-5 bg-white border border-sky-100 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Confirmed Sessions
            </span>
            <div className="p-2.5 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100">
              <Sparkles className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">
              {interviews.filter((i) => i.status === 'CONFIRMED').length}
            </span>
            <span className="chip chip-green text-[10px]">
              Ready to meet
            </span>
          </div>
          <p className="text-xs font-medium text-slate-500 mt-2">
            Accepted and locked in by candidates
          </p>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="card bg-white border border-sky-100 shadow-sm overflow-hidden">
        {/* Tabs & Search Header */}
        <div className="px-6 py-4 border-b border-sky-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Segmented Pill Tab Switcher */}
          <div className="inline-flex p-1 rounded-2xl bg-slate-100/90 border border-slate-200/80 gap-1 shadow-2xs">
            <button
              onClick={() => setActiveTab('requests')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all duration-150 ${
                activeTab === 'requests'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <Layers className="h-4 w-4 text-purple-600" />
              <span>Interview Requests</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeTab === 'requests'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-200 text-slate-700'
              }`}>
                {requests.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('interviews')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all duration-150 ${
                activeTab === 'interviews'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <CheckCircle2 className="h-4 w-4 text-purple-600" />
              <span>Scheduled Interviews</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeTab === 'interviews'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-200 text-slate-700'
              }`}>
                {interviews.length}
              </span>
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search candidate, job, round..."
              className="input pl-9.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400"
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
                    <td colSpan={6} className="text-center py-16 text-slate-400 text-sm font-semibold">
                      No interview requests match your search. Click "+ Schedule New Round" to add one!
                    </td>
                  </tr>
                ) : (
                  filteredRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-50/60 transition">
                      <td className="td">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
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
                          <span className="font-bold text-slate-900 text-xs block">
                            {req.roundName}
                          </span>
                          <span className={getTypeBadge(req.interviewType)}>
                            {req.interviewType}
                          </span>
                        </div>
                      </td>
                      <td className="td">
                        <div className="text-xs text-slate-700 font-medium space-y-0.5">
                          <div className="flex items-center gap-1 font-bold text-slate-900">
                            <Clock className="h-3.5 w-3.5 text-purple-600" />
                            <span>{req.durationMinutes} minutes</span>
                          </div>
                          <div className="text-[11px] text-slate-500 font-medium">
                            +{req.bufferMinutes}m buffer • {req.requiredInterviewerCount} interviewer(s)
                          </div>
                        </div>
                      </td>
                      <td className="td">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {(req.requiredSkills || []).slice(0, 3).map((s, idx) => (
                            <span
                              key={idx}
                              className="text-[10px] font-medium bg-slate-50 text-slate-700 px-2 py-0.5 rounded-full border border-slate-200"
                            >
                              {s.name || s}
                            </span>
                          ))}
                          {(req.requiredSkills || []).length > 3 && (
                            <span className="text-[10px] text-slate-500 self-center font-semibold">
                              +{req.requiredSkills.length - 3} more
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="td">{getStatusChip(req.status)}</td>
                      <td className="td text-right">
                        <button
                          onClick={() => navigate(`/builder?requestId=${req.id}`)}
                          disabled={req.status === 'PENDING'}
                          title={
                            req.status === 'PENDING'
                              ? 'Waiting for candidate to submit availability'
                              : 'Select time and interviewers'
                          }
                          className="btn-primary text-xs py-1.5 px-3.5 flex items-center gap-1.5 ml-auto shadow-xs disabled:opacity-40 disabled:cursor-not-allowed font-bold"
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
                  <th className="th">Scheduled Date & Time</th>
                  <th className="th">Assigned Interviewers</th>
                  <th className="th">Meeting Link</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {interviews.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-slate-400 text-sm font-semibold">
                      No interviews currently scheduled. Open a candidate request to assign a time slot.
                    </td>
                  </tr>
                ) : (
                  interviews.map((iv) => {
                    const start = DateTime.fromISO(iv.startUtc);
                    const end = DateTime.fromISO(iv.endUtc);
                    return (
                      <tr key={iv.id} className="hover:bg-slate-50/60 transition">
                        <td className="td">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                              {iv.candidate?.name?.charAt(0) || 'C'}
                            </div>
                            <div>
                              <span className="font-bold text-slate-900 text-sm block">
                                {iv.round?.name || 'Interview'}
                              </span>
                              <span className="text-xs text-slate-500 font-medium">
                                {iv.candidate?.name} • {iv.job?.title}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="td">
                          <div className="text-xs font-bold text-slate-900">
                            {start.toFormat('ccc, LLL dd, yyyy')}
                          </div>
                          <div className="text-[11px] text-slate-500 font-medium">
                            {start.toFormat('HH:mm')} – {end.toFormat('HH:mm')} (Local)
                          </div>
                        </td>
                        <td className="td">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {(iv.panel || []).map((p, idx) => (
                              <span
                                key={idx}
                                className="text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full"
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
                              className="inline-flex items-center gap-1.5 text-xs font-bold text-purple-600 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-2.5 py-1 rounded-lg"
                            >
                              <Video className="h-3.5 w-3.5 text-purple-600" /> Meeting Room
                            </a>
                          ) : (
                            <span className="text-xs text-slate-400">Generated on confirmation</span>
                          )}
                        </td>
                        <td className="td">{getStatusChip(iv.status)}</td>
                        <td className="td text-right">
                          <button
                            onClick={() => navigate(`/calendar`)}
                            className="btn-ghost text-xs py-1.5 px-3 border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold"
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
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 bg-gradient-to-r from-purple-50 via-white to-sky-50/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-tr from-purple-600 to-indigo-600 text-white rounded-2xl shadow-xs">
                  <Users className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-900">Candidate Directory & Applications</h2>
                </div>
              </div>
              <button
                onClick={() => setIsPullModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Table Body */}
            <div className="p-6 overflow-y-auto space-y-4">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 bg-slate-50 px-4 py-2.5 rounded-2xl border border-slate-200">
                <span>
                  Total Candidates:{' '}
                  <strong className="text-slate-900 font-black">{pulledCandidates.length}</strong>
                </span>
                <span className="text-purple-700 font-extrabold bg-purple-50 px-2.5 py-0.5 rounded-full border border-purple-200">
                  Ready to Schedule
                </span>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/80 text-slate-600 font-bold uppercase text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Candidate ID</th>
                      <th className="py-3 px-4">Candidate Name</th>
                      <th className="py-3 px-4">Applied Role</th>
                      <th className="py-3 px-4">Skills & Experience</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pulledCandidates.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-slate-400 font-medium">
                          No candidates found in directory.
                        </td>
                      </tr>
                    ) : (
                      pulledCandidates.map((c) => {
                        const cNumber = c.candidateNumber || `CND-${(c.id || '').slice(-4).toUpperCase()}`;
                        const app = c.applications?.[0];
                        const jobTitle = app?.jobTitle || c.headline || 'Senior Software Engineer';
                        const skillList = (c.skills || []).map((s) => s.name || s.skill?.name || s).filter(Boolean);

                        return (
                          <tr key={c.id} className="hover:bg-slate-50/60 transition">
                            <td className="py-3 px-4">
                              <span className="font-mono bg-slate-100 text-slate-800 font-bold px-2 py-1 rounded-lg text-[11px] border border-slate-200">
                                {cNumber}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-bold text-slate-900">
                              {c.name}
                            </td>
                            <td className="py-3 px-4 font-medium text-slate-500">
                              {jobTitle}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {skillList.slice(0, 4).map((sk, idx) => (
                                  <span
                                    key={idx}
                                    className="bg-slate-50 text-slate-700 px-2 py-0.5 rounded-full border text-[10px] font-medium border-slate-200"
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
                                className="btn-primary text-[11px] py-1.5 px-3.5 shadow-xs inline-flex items-center gap-1 font-bold"
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
