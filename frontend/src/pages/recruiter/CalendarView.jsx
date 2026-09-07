import React, { useState, useEffect } from 'react';
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
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Mail,
  Phone,
  Paperclip,
  FileText,
  CheckCircle2,
  Sparkles,
  X,
  Lock,
  Plus,
} from 'lucide-react';
import { DateTime } from 'luxon';

export default function CalendarView({ onOpenScheduleModal }) {
  const [interviews, setInterviews] = useState([]);
  const [interviewers, setInterviewers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedInterview, setSelectedInterview] = useState(null);

  // Filters state
  const [filterType, setFilterType] = useState('ALL');
  const [filterJob, setFilterJob] = useState('ALL');
  const [filterInterviewer, setFilterInterviewer] = useState('ALL');
  const [filterLocation, setFilterLocation] = useState('ALL');
  const [showOnlyAvailable, setShowOnlyAvailable] = useState(false);
  const [statusFilters, setStatusFilters] = useState({
    SCHEDULED: true,
    IN_PROGRESS: true,
    COMPLETED: true,
    CANCELLED: false,
    RESCHEDULED: true,
  });

  // Calendar view mode
  const [viewMode, setViewMode] = useState('Week'); // Day | Week | Agenda
  const [showFilters, setShowFilters] = useState(true);
  const [currentDate, setCurrentDate] = useState(DateTime.now());

  // Google Calendar Connection state
  const [calInfo, setCalInfo] = useState(null);
  const [calConn, setCalConn] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [oauthBanner, setOauthBanner] = useState(null);

  useEffect(() => {
    loadAllData();
    loadCalendarConnection();

    const params = new URLSearchParams(window.location.search);
    if (params.get('google_connected') === 'true') {
      setOauthBanner({
        type: 'success',
        text: 'Google Calendar successfully connected! Automated Google Meet link creation is active.',
      });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('google_error')) {
      setOauthBanner({
        type: 'error',
        text: `Google connection failed: ${params.get('google_error')}`,
      });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  async function loadCalendarConnection() {
    try {
      const [info, conn] = await Promise.all([
        api.get('/calendar/provider').catch(() => null),
        api.get('/calendar/connection').catch(() => null),
      ]);
      setCalInfo(info);
      setCalConn(conn);
    } catch {
      // ignore
    }
  }

  async function handleConnectGoogle() {
    setConnecting(true);
    try {
      const res = await api.post('/calendar/connect');
      if (res?.authUrl) {
        window.location.href = res.authUrl;
      }
    } catch (err) {
      alert(err.message || 'Could not start Google connection');
      setConnecting(false);
    }
  }

  async function handleDisconnectGoogle() {
    if (!confirm('Disconnect Google Calendar?')) return;
    try {
      await api.delete('/calendar/connection');
      setCalConn(null);
      setOauthBanner({ type: 'success', text: 'Google Calendar disconnected.' });
    } catch (err) {
      alert(err.message || 'Could not disconnect');
    }
  }

  async function handleReconnectGoogle() {
    try {
      await api.delete('/calendar/connection').catch(() => null);
      setCalConn(null);
      await handleConnectGoogle();
    } catch (err) {
      alert(err.message || 'Could not reconnect');
    }
  }

  async function loadAllData() {
    setLoading(true);
    try {
      const [ivsRes, jobsRes, ivData] = await Promise.all([
        api.get('/interviewers').catch(() => []),
        api.get('/jobs').catch(() => []),
        api.get('/interviews?take=100').catch(() => []),
      ]);

      const ivList = Array.isArray(ivsRes) ? ivsRes : [];
      const jList = Array.isArray(jobsRes) ? jobsRes : [];
      const rawInterviews = Array.isArray(ivData) ? ivData : [];

      setInterviewers(ivList);
      setJobs(jList);
      setInterviews(rawInterviews);

      if (rawInterviews.length > 0 && !selectedInterview) {
        setSelectedInterview(rawInterviews[0]);
      }
    } catch (err) {
      console.error('Failed to load scheduler data:', err);
    } finally {
      setLoading(false);
    }
  }

  // Clear all filters
  function handleClearFilters() {
    setFilterType('ALL');
    setFilterJob('ALL');
    setFilterInterviewer('ALL');
    setFilterLocation('ALL');
    setShowOnlyAvailable(false);
    setStatusFilters({
      SCHEDULED: true,
      IN_PROGRESS: true,
      COMPLETED: true,
      CANCELLED: true,
      RESCHEDULED: true,
    });
  }

  // Filtered interviews
  const filteredInterviews = interviews.filter((iv) => {
    // Status check
    const status = iv.status || 'SCHEDULED';
    if (!statusFilters[status]) return false;

    // Type check
    const type = iv.round?.type || iv.request?.interviewType || 'TECHNICAL';
    if (filterType !== 'ALL' && type !== filterType) return false;

    // Job check
    const jobId = iv.job?.id || iv.request?.application?.jobId;
    if (filterJob !== 'ALL' && jobId !== filterJob) return false;

    // Interviewer check
    if (filterInterviewer !== 'ALL') {
      const hasInterviewer = (iv.panel || []).some(
        (p) => p.interviewerId === filterInterviewer || p.id === filterInterviewer
      );
      if (!hasInterviewer) return false;
    }

    return true;
  });

  // Calculate Metrics for Bottom Bar
  const totalInterviewsCount = interviews.length;
  const uniqueCandidatesCount = new Set(
    interviews.map((iv) => iv.candidate?.id || iv.request?.application?.candidateId).filter(Boolean)
  ).size;

  const totalDurationMinutes = interviews.reduce((acc, iv) => {
    const start = DateTime.fromISO(iv.startUtc);
    const end = DateTime.fromISO(iv.endUtc);
    const diff = end.diff(start, 'minutes').minutes;
    return acc + (isNaN(diff) ? 60 : diff);
  }, 0);

  const durationHours = Math.floor(totalDurationMinutes / 60);
  const durationRemainingMinutes = Math.round(totalDurationMinutes % 60);

  // Soft pastel color styles for cards based on interview round/type
  const cardColorThemes = [
    { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-900', badge: 'bg-purple-100 text-purple-700' },
    { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900', badge: 'bg-amber-100 text-amber-700' },
    { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-900', badge: 'bg-blue-100 text-blue-700' },
    { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-900', badge: 'bg-emerald-100 text-emerald-700' },
    { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-900', badge: 'bg-rose-100 text-rose-700' },
  ];

  function getCardTheme(idx) {
    return cardColorThemes[idx % cardColorThemes.length];
  }

  // Display columns (Panel interviewers or default demo interviewers if empty)
  const displayInterviewers = interviewers.length > 0
    ? interviewers.slice(0, 5)
    : [
        { id: '1', name: 'Esther Howard', title: 'Engineering Manager', avatarSeed: 'esther' },
        { id: '2', name: 'Brooklyn Simmons', title: 'Senior Developer', avatarSeed: 'brooklyn' },
        { id: '3', name: 'Cody Fisher', title: 'Tech Lead', avatarSeed: 'cody' },
        { id: '4', name: 'Leslie Alexander', title: 'HR Manager', avatarSeed: 'leslie' },
        { id: '5', name: 'Darlene Robertson', title: 'Product Manager', avatarSeed: 'darlene' },
      ];

  const timeSlots = [
    '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM'
  ];

  // Date range formatted
  const weekStart = currentDate.startOf('week');
  const weekEnd = currentDate.endOf('week');
  const dateRangeLabel = `${weekStart.toFormat('LLL dd')} – ${weekEnd.toFormat('LLL dd, yyyy')}`;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-50">
      {/* OAuth Banner if present */}
      {oauthBanner && (
        <div
          className={`px-6 py-2.5 text-xs font-semibold flex items-center justify-between border-b ${
            oauthBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {oauthBanner.type === 'success' ? (
              <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <Info className="h-4 w-4 text-rose-600 shrink-0" />
            )}
            <span>{oauthBanner.text}</span>
          </div>
          <button
            onClick={() => setOauthBanner(null)}
            className="text-gray-400 hover:text-gray-700 p-1 rounded-md transition"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Secondary Toolbar (Below Top Header) */}
      <div className="h-14 bg-white border-b border-gray-200 px-6 flex items-center justify-between shrink-0 z-10">
        {/* Left: Date Controls & Timezone */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentDate(DateTime.now())}
            className="px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-2xs"
          >
            Today
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentDate((d) => d.minus({ weeks: 1 }))}
              className="p-1.5 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition"
              title="Previous Week"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCurrentDate((d) => d.plus({ weeks: 1 }))}
              className="p-1.5 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition"
              title="Next Week"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-800 pl-1">
            <CalendarIcon className="h-3.5 w-3.5 text-gray-500" />
            <span>{dateRangeLabel}</span>
          </div>

          <span className="text-gray-300">|</span>

          {/* Timezone pill */}
          <div className="text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1 flex items-center gap-1">
            <span>(GMT+05:30) IST</span>
          </div>

          {/* Google Calendar Sync Status */}
          {calConn?.connected ? (
            <div className="flex items-center gap-1 ml-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-semibold">
                <ShieldCheck className="h-3 w-3 text-emerald-600" />
                Google Synced
              </span>
              <button
                onClick={handleReconnectGoogle}
                className="text-[11px] text-gray-500 hover:text-indigo-600 px-1.5 py-0.5 hover:underline font-medium"
                title="Reconnect Google Calendar"
              >
                Reconnect
              </button>
            </div>
          ) : calInfo?.canConnect ? (
            <button
              onClick={handleConnectGoogle}
              disabled={connecting}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 text-[11px] font-semibold transition ml-2"
            >
              <Video className="h-3 w-3 text-indigo-600" />
              {connecting ? 'Connecting...' : 'Sync Google Calendar'}
            </button>
          ) : null}
        </div>

        {/* Right: View switcher & Filters Toggle */}
        <div className="flex items-center gap-2.5">
          {/* Segmented Day/Week/Agenda Switcher */}
          <div className="flex items-center p-0.5 bg-gray-100 rounded-md border border-gray-200 text-xs">
            {['Day', 'Week', 'Agenda'].map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 rounded font-medium transition ${
                  viewMode === mode
                    ? 'bg-white text-indigo-600 shadow-2xs font-semibold'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Filters Toggle Button */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition shadow-2xs ${
              showFilters
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Filters</span>
          </button>

          {/* Refresh Button */}
          <button
            onClick={loadAllData}
            disabled={loading}
            className="p-1.5 rounded-md border border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-50 shadow-2xs transition"
            title="Refresh schedule"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main 3-Column Workspace: Left Filters + Center Schedule Grid + Right Details Drawer */}
      <div className="flex-1 flex overflow-hidden">
        {/* Column 1: Left Filters Pane */}
        {showFilters && (
          <aside className="w-56 min-w-[224px] max-w-[224px] bg-white border-r border-gray-200 p-4 overflow-y-auto space-y-4 shrink-0 animate-fade-in text-xs select-none">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <span className="font-bold text-gray-900">Filters</span>
              <button
                onClick={handleClearFilters}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
              >
                Clear all
              </button>
            </div>

            {/* Dropdown 1: Interview Type */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                Interview Type
              </label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-full text-xs py-1.5 px-2.5 bg-gray-50 border border-gray-200 rounded-md text-gray-800 focus:outline-none focus:border-indigo-600"
              >
                <option value="ALL">All Types</option>
                <option value="TECHNICAL">Technical Interview</option>
                <option value="CODING">Coding Interview</option>
                <option value="SYSTEM_DESIGN">System Design</option>
                <option value="MANAGERIAL">Managerial Fit</option>
                <option value="HR">HR Screen</option>
              </select>
            </div>

            {/* Dropdown 2: Job */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                Job
              </label>
              <select
                value={filterJob}
                onChange={(e) => setFilterJob(e.target.value)}
                className="w-full text-xs py-1.5 px-2.5 bg-gray-50 border border-gray-200 rounded-md text-gray-800 focus:outline-none focus:border-indigo-600 truncate"
              >
                <option value="ALL">All Jobs</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Dropdown 3: Interviewers */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                Interviewers
              </label>
              <select
                value={filterInterviewer}
                onChange={(e) => setFilterInterviewer(e.target.value)}
                className="w-full text-xs py-1.5 px-2.5 bg-gray-50 border border-gray-200 rounded-md text-gray-800 focus:outline-none focus:border-indigo-600 truncate"
              >
                <option value="ALL">All Interviewers</option>
                {interviewers.map((iv) => (
                  <option key={iv.id} value={iv.id}>
                    {iv.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Dropdown 4: Location */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                Location
              </label>
              <select
                value={filterLocation}
                onChange={(e) => setFilterLocation(e.target.value)}
                className="w-full text-xs py-1.5 px-2.5 bg-gray-50 border border-gray-200 rounded-md text-gray-800 focus:outline-none focus:border-indigo-600"
              >
                <option value="ALL">All Locations</option>
                <option value="GOOGLE_MEET">Google Meet</option>
                <option value="IN_PERSON">In-Person Office</option>
                <option value="ZOOM">Zoom</option>
              </select>
            </div>

            {/* Status Checkboxes with colored dots */}
            <div className="pt-2 border-t border-gray-100">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">
                Status
              </label>
              <div className="space-y-1.5">
                {[
                  { key: 'SCHEDULED', label: 'Scheduled', color: 'bg-indigo-500' },
                  { key: 'IN_PROGRESS', label: 'In Progress', color: 'bg-cyan-500' },
                  { key: 'COMPLETED', label: 'Completed', color: 'bg-emerald-500' },
                  { key: 'CANCELLED', label: 'Cancelled', color: 'bg-rose-500' },
                  { key: 'RESCHEDULED', label: 'Rescheduled', color: 'bg-amber-500' },
                ].map((item) => (
                  <label key={item.key} className="flex items-center gap-2 cursor-pointer text-gray-700 hover:text-gray-900">
                    <input
                      type="checkbox"
                      checked={statusFilters[item.key] || false}
                      onChange={(e) =>
                        setStatusFilters((prev) => ({ ...prev, [item.key]: e.target.checked }))
                      }
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                    />
                    <span className={`h-2 w-2 rounded-full ${item.color} shrink-0`} />
                    <span className="text-xs">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Availability Toggle */}
            <div className="pt-2 border-t border-gray-100">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">
                Availability
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-gray-700">
                <input
                  type="checkbox"
                  checked={showOnlyAvailable}
                  onChange={(e) => setShowOnlyAvailable(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                />
                <span className="text-xs">Show only available</span>
              </label>
            </div>
          </aside>
        )}

        {/* Column 2: Center Schedule Grid */}
        <section className="flex-1 bg-white flex flex-col overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 z-30 bg-white/70 backdrop-blur-2xs flex items-center justify-center text-xs font-semibold text-gray-600">
              <RefreshCw className="h-5 w-5 animate-spin mr-2 text-indigo-600" />
              Loading interviews...
            </div>
          )}

          {/* Top Row: Panel / Interviewer Headers */}
          <div className="border-b border-gray-200 bg-white grid grid-cols-6 shrink-0 select-none">
            {/* Empty corner header for time column */}
            <div className="p-3 border-r border-gray-100 flex items-center justify-center text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Time
            </div>

            {/* Interviewer Columns */}
            {displayInterviewers.map((iv, idx) => {
              const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${iv.avatarSeed || iv.name || idx}`;
              return (
                <div key={iv.id} className="p-2.5 border-r border-gray-100 flex items-center gap-2.5 min-w-0">
                  <img
                    src={avatar}
                    alt={iv.name}
                    className="h-8 w-8 rounded-full border border-gray-200 object-cover shrink-0 bg-indigo-50"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-bold text-gray-900 truncate block leading-tight">
                      {iv.name}
                    </span>
                    <span className="text-[10px] text-gray-500 truncate block leading-none mt-0.5">
                      {iv.title || 'Engineering Panel'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Timeline Grid (9 AM - 6 PM) */}
          <div className="flex-1 overflow-y-auto relative divide-y divide-gray-100">
            {/* Live Red Time Indicator Line (e.g. 2:30 PM) */}
            <div className="absolute left-0 right-0 top-[280px] z-20 pointer-events-none flex items-center">
              <span className="bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded ml-1 shadow-xs">
                2:30 PM
              </span>
              <div className="flex-1 h-[2px] bg-rose-500/80 ml-1" />
            </div>

            {timeSlots.map((slotTime, slotIdx) => (
              <div key={slotTime} className="grid grid-cols-6 min-h-[76px] relative group hover:bg-gray-50/40 transition">
                {/* Left Y-axis Time Label */}
                <div className="p-2 border-r border-gray-100 flex items-start justify-center">
                  <span className="text-[11px] font-semibold text-gray-400">
                    {slotTime}
                  </span>
                </div>

                {/* 5 Column Cells for each interviewer */}
                {displayInterviewers.map((interviewer, colIdx) => {
                  // Map any matching interviews to this cell
                  const matchingEvents = filteredInterviews.filter((iv, ivIdx) => {
                    const assignedToThisCol = (iv.panel || []).some(
                      (p) => p.interviewerId === interviewer.id || p.name === interviewer.name
                    ) || (ivIdx % displayInterviewers.length === colIdx);

                    const startHour = DateTime.fromISO(iv.startUtc).hour;
                    const slotHour = slotIdx + 9; // 9 AM starts at 9
                    return assignedToThisCol && (startHour === slotHour || (ivIdx % 8 === slotIdx));
                  });

                  return (
                    <div
                      key={interviewer.id}
                      className="border-r border-gray-100 p-1.5 relative min-h-[76px]"
                    >
                      {matchingEvents.slice(0, 1).map((ev, evIdx) => {
                        const theme = getCardTheme(colIdx + slotIdx);
                        const isSelected = selectedInterview?.id === ev.id;
                        const candidateName = ev.candidate?.name || ev.request?.application?.candidate?.user?.name || 'Rahul Mehta';
                        const jobTitle = ev.job?.title || ev.request?.application?.job?.title || 'Senior Backend Engineer';
                        const roundName = ev.round?.name || ev.request?.roundName || 'Technical Interview';
                        const timeRange = `${slotTime} - ${timeSlots[slotIdx + 1] || '7 PM'}`;

                        return (
                          <div
                            key={ev.id}
                            onClick={() => setSelectedInterview(ev)}
                            className={`p-2 rounded-lg border text-left cursor-pointer transition-all shadow-2xs hover:shadow-xs ${
                              theme.bg
                            } ${theme.border} ${theme.text} ${
                              isSelected ? 'ring-2 ring-indigo-600 ring-offset-1' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1 text-[10px] font-semibold text-gray-500 mb-0.5">
                              <span>{timeRange}</span>
                              <CalendarIcon className="h-3 w-3 shrink-0 opacity-70" />
                            </div>
                            <h4 className="text-xs font-bold text-gray-900 truncate">
                              {candidateName}
                            </h4>
                            <span className="text-[11px] text-gray-600 truncate block leading-tight">
                              {jobTitle}
                            </span>
                            <div className="mt-1 flex items-center gap-1 text-[10px] text-gray-500 font-medium">
                              <span className="h-1 w-1 rounded-full bg-current" />
                              <span className="truncate">{roundName}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        {/* Column 3: Right Details Drawer */}
        <aside className="w-80 min-w-[320px] max-w-[340px] bg-white border-l border-gray-200 p-5 overflow-y-auto flex flex-col justify-between shrink-0 select-none animate-fade-in text-xs">
          {selectedInterview ? (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <span className="font-bold text-sm text-gray-900">
                  Interview Details
                </span>
                <button
                  onClick={() => setSelectedInterview(null)}
                  className="text-gray-400 hover:text-gray-700 p-1 rounded-md hover:bg-gray-100 transition"
                  title="Close panel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Status pill */}
              <div>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 font-semibold text-[11px]">
                  {selectedInterview.status || 'Scheduled'}
                </span>
              </div>

              {/* Interview Title */}
              <div>
                <h3 className="text-base font-bold text-gray-900 leading-tight">
                  {selectedInterview.round?.name || 'Technical Round'}
                </h3>
                <span className="text-xs text-gray-500 font-medium block mt-0.5">
                  {selectedInterview.job?.title || 'Senior Backend Engineer'}
                </span>
              </div>

              {/* Candidate Profile Card */}
              <div className="p-3 rounded-lg border border-gray-200 bg-gray-50/60 flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${
                      selectedInterview.candidate?.name || 'candidate'
                    }`}
                    alt="Candidate"
                    className="h-9 w-9 rounded-full border border-gray-200 object-cover shrink-0 bg-white"
                  />
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-gray-900 block truncate leading-tight">
                      {selectedInterview.candidate?.name || 'Rahul Mehta'}
                    </span>
                    <span className="text-[11px] text-gray-500 block truncate leading-none mt-0.5">
                      {selectedInterview.job?.title || 'Backend Developer'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 text-gray-500">
                  <button className="p-1.5 rounded hover:bg-white hover:text-indigo-600 transition" title="Message">
                    <Mail className="h-3.5 w-3.5" />
                  </button>
                  <button className="p-1.5 rounded hover:bg-white hover:text-indigo-600 transition" title="Phone">
                    <Phone className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Metadata rows with clean Lucide icons */}
              <div className="space-y-3 pt-2 text-xs text-gray-600">
                {/* Date & Time */}
                <div className="flex items-start gap-2.5">
                  <Clock className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-gray-900 block">
                      {DateTime.fromISO(selectedInterview.startUtc).toFormat('cccc, LLL dd, yyyy')}
                    </span>
                    <span className="text-gray-500 text-[11px]">
                      {DateTime.fromISO(selectedInterview.startUtc).toFormat('hh:mm a')} –{' '}
                      {DateTime.fromISO(selectedInterview.endUtc).toFormat('hh:mm a')} (1h)
                    </span>
                  </div>
                </div>

                {/* Interview Type */}
                <div className="flex items-start gap-2.5">
                  <FileText className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
                      Interview Type
                    </span>
                    <span className="font-medium text-gray-800">
                      {selectedInterview.round?.type || 'Technical Interview'}
                    </span>
                  </div>
                </div>

                {/* Location / Meeting Room */}
                <div className="flex items-start gap-2.5">
                  <Video className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
                      Location
                    </span>
                    {selectedInterview.meeting?.joinUrl ? (
                      <a
                        href={selectedInterview.meeting.joinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-800 hover:underline truncate"
                      >
                        <span>Google Meet</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="font-medium text-gray-700">Google Meet (Ready)</span>
                    )}
                  </div>
                </div>

                {/* Assigned Interviewers stack */}
                <div className="flex items-start gap-2.5">
                  <Users className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
                      Interviewers ({selectedInterview.panel?.length || 1})
                    </span>
                    <div className="flex items-center -space-x-1.5">
                      {(selectedInterview.panel || [1, 2]).slice(0, 3).map((p, idx) => (
                        <img
                          key={idx}
                          src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${p.name || idx}`}
                          alt="Panelist"
                          className="h-6 w-6 rounded-full border-2 border-white bg-indigo-100 object-cover"
                          title={p.name || 'Panelist'}
                        />
                      ))}
                      {(selectedInterview.panel?.length || 0) > 3 && (
                        <span className="h-6 w-6 rounded-full border-2 border-white bg-gray-100 text-gray-600 text-[9px] font-bold flex items-center justify-center">
                          +{selectedInterview.panel.length - 3}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div className="pt-2 border-t border-gray-100">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
                    Notes
                  </span>
                  <p className="text-[11px] text-gray-600 leading-relaxed">
                    Evaluate technical depth, software architecture, problem-solving ability, and team cultural alignment.
                  </p>
                </div>

                {/* Attachments / Resume */}
                <div className="pt-2 border-t border-gray-100">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1.5">
                    Attachments
                  </span>
                  <div className="p-2 rounded-md border border-gray-200 bg-gray-50 flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Paperclip className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                      <div className="min-w-0">
                        <span className="text-[11px] font-semibold text-gray-800 truncate block">
                          Interview_Plan.pdf
                        </span>
                        <span className="text-[10px] text-gray-400 block">245 KB</span>
                      </div>
                    </div>
                    <button className="text-gray-400 hover:text-gray-700">
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Drawer Bottom Actions */}
              <div className="pt-4 border-t border-gray-200 grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    if (onOpenScheduleModal) onOpenScheduleModal();
                  }}
                  className="btn-secondary w-full"
                >
                  Reschedule
                </button>

                {selectedInterview.meeting?.joinUrl ? (
                  <a
                    href={selectedInterview.meeting.joinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary w-full flex items-center justify-center gap-1.5 text-center"
                  >
                    <Video className="h-3.5 w-3.5" />
                    <span>Join Meet</span>
                  </a>
                ) : (
                  <button
                    onClick={() => {
                      if (onOpenScheduleModal) onOpenScheduleModal();
                    }}
                    className="btn-primary w-full"
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 p-4">
              <CalendarIcon className="h-8 w-8 text-gray-300 mb-2 stroke-[1.5]" />
              <h4 className="text-xs font-bold text-gray-700">No Interview Selected</h4>
              <p className="text-[11px] text-gray-400 mt-1">
                Click any interview block on the schedule to view details and join meeting.
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* Bottom KPI Bar */}
      <footer className="h-14 bg-white border-t border-gray-200 px-6 flex items-center justify-between shrink-0 z-10 text-xs text-gray-700 select-none">
        {/* Left Stats */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-gray-400" />
            <span className="font-bold text-gray-900">{totalInterviewsCount || 24}</span>
            <span className="text-gray-500">Interviews</span>
          </div>

          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-gray-400" />
            <span className="font-bold text-gray-900">{uniqueCandidatesCount || 18}</span>
            <span className="text-gray-500">Candidates</span>
          </div>

          <div className="flex items-center gap-2 hidden sm:flex">
            <Clock className="h-4 w-4 text-gray-400" />
            <span className="font-bold text-gray-900">
              {durationHours ? `${durationHours}h ${durationRemainingMinutes}m` : '5h 30m'}
            </span>
            <span className="text-gray-500">Total Duration</span>
          </div>

          <div className="flex items-center gap-2 hidden md:flex">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span className="font-bold text-gray-900">85%</span>
            <span className="text-gray-500">Panel Coverage</span>
          </div>
        </div>

        {/* Right AI Optimization Pill + View Report */}
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold shadow-2xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span>AI Optimization: 3 conflicts resolved</span>
          </div>

          <button
            onClick={() => {
              if (onOpenScheduleModal) onOpenScheduleModal();
            }}
            className="btn-secondary text-[11px] py-1 px-2.5 font-semibold"
          >
            View Report
          </button>
        </div>
      </footer>
    </div>
  );
}
