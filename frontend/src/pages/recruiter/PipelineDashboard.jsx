import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
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
  RotateCcw,
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
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const navigate = useNavigate();
  const { logout } = useAuth();

  // Rebuilding the demo data deletes and recreates every user, so the current
  // session's token points at a row that no longer exists. Sign out and send
  // the user back to login rather than letting the next call 401.
  async function runDemoReset() {
    setResetting(true);
    setResetError('');
    try {
      await api.post('/demo/reset', {});
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setResetError(err?.message || 'Reset failed.');
      setResetting(false);
    }
  }

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
        return <span className="chip chip-amber font-semibold">Awaiting Slots</span>;
      case 'PROPOSED':
        return <span className="chip chip-blue font-semibold">Slots Submitted</span>;
      case 'SCHEDULED':
      case 'CONFIRMED':
        return <span className="chip chip-green font-semibold">Scheduled & Booked</span>;
      case 'COMPLETED':
        return <span className="chip border-gray-200 bg-gray-100 text-gray-700 font-semibold">Completed</span>;
      case 'CANCELLED':
      case 'FAILED':
        return <span className="chip chip-red font-semibold">{status}</span>;
      default:
        return <span className="chip border-gray-200 bg-gray-50 text-gray-700">{status}</span>;
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
        return 'chip border-gray-200 bg-gray-50 text-gray-700';
      default:
        return 'chip chip-blue';
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 animate-fade-in">
      {/* Top Banner */}
      <div className="card p-5 bg-white border border-gray-200 shadow-2xs mb-6 rounded-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900">
                  Interview Pipeline
                </h1>
                <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                  Recruiter Operations
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Manage candidate rounds, book interviews, and monitor live scheduling health.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <button
              onClick={loadDashboardData}
              className="px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-2xs flex items-center gap-1.5 transition"
              title="Refresh Data"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-gray-500 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button
              onClick={() => setIsResetOpen(true)}
              className="px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-semibold text-gray-500 hover:text-rose-700 hover:bg-rose-50 shadow-2xs flex items-center gap-1.5 transition"
              title="Rebuild the demo dataset from scratch"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset Demo
            </button>
            <button
              onClick={() => setIsPullModalOpen(true)}
              className="px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-2xs flex items-center gap-1.5 transition"
            >
              <UserCheck className="h-3.5 w-3.5 text-indigo-600" /> Candidates ({pulledCandidates.length})
            </button>
            <button
              onClick={() => {
                setSelectedApplicationId(null);
                setIsModalOpen(true);
              }}
              className="btn-primary text-xs py-1.5 px-3.5 flex items-center gap-1.5 font-semibold rounded-md shadow-2xs"
            >
              <Plus className="h-4 w-4" /> Schedule New Round
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Card 1: Active Requests */}
        <div className="card p-5 bg-white border border-gray-200 shadow-2xs rounded-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Interview Requests
            </span>
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
              <Layers className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-gray-900">{requests.length}</span>
            <span className="chip chip-amber text-[10px]">
              {requests.filter((r) => r.status === 'PENDING' || r.status === 'PROPOSED').length} awaiting slots
            </span>
          </div>
          <p className="text-xs font-medium text-gray-500 mt-2">Active interview round requests</p>
        </div>

        {/* Card 2: Booked Interviews */}
        <div className="card p-5 bg-white border border-gray-200 shadow-2xs rounded-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Scheduled Interviews
            </span>
            <div className="p-2 rounded-lg bg-sky-50 text-sky-600 border border-sky-100">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-gray-900">{interviews.length}</span>
            <span className="chip chip-blue text-[10px]">
              On calendar
            </span>
          </div>
          <p className="text-xs font-medium text-gray-500 mt-2">Confirmed conflict-free sessions</p>
        </div>

        {/* Card 3: Control Tower Incidents */}
        <div
          onClick={() => navigate('/control-tower')}
          className="card p-5 bg-white border border-gray-200 hover:border-gray-300 shadow-2xs rounded-lg cursor-pointer transition group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Scheduling Alerts
            </span>
            <div className="p-2 rounded-lg bg-rose-50 text-rose-600 border border-rose-100 group-hover:scale-105 transition">
              <ShieldAlert className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-gray-900">{incidents.length}</span>
            <span className={`chip text-[10px] ${incidents.length > 0 ? 'chip-red' : 'chip-green'}`}>
              {incidents.length > 0 ? 'Action Needed' : 'All Clear'}
            </span>
          </div>
          <p className="text-xs text-indigo-600 mt-2 flex items-center gap-1 font-semibold group-hover:text-indigo-800">
            View schedule resolution <ArrowRight className="h-3 w-3" />
          </p>
        </div>

        {/* Card 4: Confirmed interviews */}
        <div className="card p-5 bg-white border border-gray-200 shadow-2xs rounded-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Confirmed Sessions
            </span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100">
              <Sparkles className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-gray-900">
              {interviews.filter((i) => i.status === 'CONFIRMED').length}
            </span>
            <span className="chip chip-green text-[10px]">
              Ready to meet
            </span>
          </div>
          <p className="text-xs font-medium text-gray-500 mt-2">
            Accepted and locked in by candidates
          </p>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="card bg-white border border-gray-200 shadow-2xs rounded-lg overflow-hidden">
        {/* Tabs & Search Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Segmented Pill Tab Switcher */}
          <div className="inline-flex p-1 rounded-md bg-gray-100 border border-gray-200 gap-1 shadow-2xs">
            <button
              onClick={() => setActiveTab('requests')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-2 transition-all duration-150 ${
                activeTab === 'requests'
                  ? 'bg-white text-gray-900 shadow-2xs border border-gray-200'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
              }`}
            >
              <Layers className="h-3.5 w-3.5 text-indigo-600" />
              <span>Interview Requests</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeTab === 'requests'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-200 text-gray-700'
              }`}>
                {requests.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('interviews')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-2 transition-all duration-150 ${
                activeTab === 'interviews'
                  ? 'bg-white text-gray-900 shadow-2xs border border-gray-200'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600" />
              <span>Scheduled Interviews</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeTab === 'interviews'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-200 text-gray-700'
              }`}>
                {interviews.length}
              </span>
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search candidate, job, round..."
              className="input pl-9.5 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 rounded-md"
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
              <tbody className="divide-y divide-gray-100">
                {filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-gray-400 text-sm font-semibold">
                      No interview requests match your search. Click "+ Schedule New Round" to add one!
                    </td>
                  </tr>
                ) : (
                  filteredRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-gray-50/60 transition">
                      <td className="td">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs shrink-0">
                            {req.candidate?.name?.charAt(0) || 'C'}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-900 text-sm block">
                              {req.candidate?.name || 'Candidate'}
                            </span>
                            <span className="text-xs text-gray-500 font-medium">
                              {req.job?.title || 'Engineer'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="td">
                        <div className="space-y-1">
                          <span className="font-semibold text-gray-900 text-xs block">
                            {req.roundName}
                          </span>
                          <span className={getTypeBadge(req.interviewType)}>
                            {req.interviewType}
                          </span>
                        </div>
                      </td>
                      <td className="td">
                        <div className="text-xs text-gray-700 font-medium space-y-0.5">
                          <div className="flex items-center gap-1 font-semibold text-gray-900">
                            <Clock className="h-3.5 w-3.5 text-indigo-600" />
                            <span>{req.durationMinutes} minutes</span>
                          </div>
                          <div className="text-[11px] text-gray-500 font-medium">
                            +{req.bufferMinutes}m buffer • {req.requiredInterviewerCount} interviewer(s)
                          </div>
                        </div>
                      </td>
                      <td className="td">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {(req.requiredSkills || []).slice(0, 3).map((s, idx) => (
                            <span
                              key={idx}
                              className="text-[10px] font-medium bg-gray-50 text-gray-700 px-2 py-0.5 rounded-full border border-gray-200"
                            >
                              {s.name || s}
                            </span>
                          ))}
                          {(req.requiredSkills || []).length > 3 && (
                            <span className="text-[10px] text-gray-500 self-center font-semibold">
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
                          className="btn-primary text-xs py-1.5 px-3.5 inline-flex items-center gap-1.5 ml-auto rounded-md shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
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
              <tbody className="divide-y divide-gray-100">
                {interviews.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-gray-400 text-sm font-semibold">
                      No interviews currently scheduled. Open a candidate request to assign a time slot.
                    </td>
                  </tr>
                ) : (
                  interviews.map((iv) => {
                    const start = DateTime.fromISO(iv.startUtc);
                    const end = DateTime.fromISO(iv.endUtc);
                    return (
                      <tr key={iv.id} className="hover:bg-gray-50/60 transition">
                        <td className="td">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs shrink-0">
                              {iv.candidate?.name?.charAt(0) || 'C'}
                            </div>
                            <div>
                              <span className="font-semibold text-gray-900 text-sm block">
                                {iv.round?.name || 'Interview'}
                              </span>
                              <span className="text-xs text-gray-500 font-medium">
                                {iv.candidate?.name} • {iv.job?.title}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="td">
                          <div className="text-xs font-semibold text-gray-900">
                            {start.toFormat('ccc, LLL dd, yyyy')}
                          </div>
                          <div className="text-[11px] text-gray-500 font-medium">
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
                              href={iv.meeting.joinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-md transition"
                              title="Open Google Meet call"
                            >
                              <Video className="h-3.5 w-3.5 text-emerald-600" /> Google Meet <ExternalLink className="h-3 w-3 text-emerald-500" />
                            </a>
                          ) : (
                            <span className="text-xs text-gray-400">Generated on confirmation</span>
                          )}
                        </td>
                        <td className="td">{getStatusChip(iv.status)}</td>
                        <td className="td text-right">
                          <button
                            onClick={() => navigate(`/calendar`)}
                            className="px-3 py-1 rounded-md border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition"
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
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-lg max-w-4xl w-full shadow-xl overflow-hidden border border-gray-200 flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-lg">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Candidate Directory & Applications</h2>
                  <p className="text-xs text-gray-500">View candidates and create scheduled interview requests.</p>
                </div>
              </div>
              <button
                onClick={() => setIsPullModalOpen(false)}
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Table Body */}
            <div className="p-5 overflow-y-auto space-y-4">
              <div className="flex items-center justify-between text-xs font-semibold text-gray-700 bg-gray-50 px-4 py-2.5 rounded-md border border-gray-200">
                <span>
                  Total Candidates:{' '}
                  <strong className="text-gray-900 font-bold">{pulledCandidates.length}</strong>
                </span>
                <span className="text-indigo-700 font-semibold bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200">
                  Ready to Schedule
                </span>
              </div>

              <div className="overflow-x-auto rounded-md border border-gray-200 shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 text-gray-600 font-bold uppercase text-[11px] border-b border-gray-200">
                    <tr>
                      <th className="py-3 px-4">Candidate ID</th>
                      <th className="py-3 px-4">Candidate Name</th>
                      <th className="py-3 px-4">Applied Role</th>
                      <th className="py-3 px-4">Skills & Experience</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pulledCandidates.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-gray-400 font-medium">
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
                          <tr key={c.id} className="hover:bg-gray-50/60 transition">
                            <td className="py-3 px-4">
                              <span className="font-mono bg-gray-100 text-gray-800 font-semibold px-2 py-0.5 rounded text-[11px] border border-gray-200">
                                {cNumber}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-semibold text-gray-900">
                              {c.name}
                            </td>
                            <td className="py-3 px-4 font-medium text-gray-500">
                              {jobTitle}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {skillList.slice(0, 4).map((sk, idx) => (
                                  <span
                                    key={idx}
                                    className="bg-gray-50 text-gray-700 px-2 py-0.5 rounded-full border text-[10px] font-medium border-gray-200"
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
                                className="btn-primary text-[11px] py-1.5 px-3 rounded-md shadow-2xs inline-flex items-center gap-1 font-semibold"
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

      {isResetOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-lg max-w-md w-full shadow-xl overflow-hidden border border-gray-200">
            <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center gap-3">
              <div className="p-2 bg-rose-100 text-rose-700 rounded-lg">
                <RotateCcw className="h-5 w-5" />
              </div>
              <h2 className="text-base font-bold text-gray-900">Reset demo data</h2>
            </div>

            <div className="p-5 space-y-3 text-sm text-gray-600">
              <p>
                This deletes <strong className="text-gray-900">everything</strong> — jobs, candidates,
                requests, interviews, feedback and incidents — and rebuilds the scripted demo dataset
                from scratch.
              </p>
              <p>
                All accounts are recreated, so you will be signed out and need to log back in with{' '}
                <code className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-800 font-mono text-xs border border-gray-200">
                  Password123
                </code>
                .
              </p>
              {resetError && (
                <p className="text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 text-xs font-semibold">
                  {resetError}
                </p>
              )}
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                onClick={() => setIsResetOpen(false)}
                disabled={resetting}
                className="px-3 py-1.5 rounded-md border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={runDemoReset}
                disabled={resetting}
                className="text-xs py-1.5 px-3.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-semibold flex items-center gap-1.5 disabled:opacity-60 transition"
              >
                <RotateCcw className={`h-4 w-4 ${resetting ? 'animate-spin' : ''}`} />
                {resetting ? 'Rebuilding…' : 'Reset everything'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
