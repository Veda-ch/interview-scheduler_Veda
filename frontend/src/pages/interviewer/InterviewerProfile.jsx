import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import TimezoneCard from '../../components/TimezoneCard.jsx';
import {
  Clock,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Zap,
  Award,
  Save,
  CalendarDays,
  ShieldCheck,
  Briefcase,
} from 'lucide-react';
import { DateTime } from 'luxon';

const KIND_STYLES = {
  PREFERRED: 'chip-purple',
  AVAILABLE: 'chip-green',
  UNAVAILABLE: 'chip-red',
};

const INTERVIEW_TYPES = ['TECHNICAL', 'CODING', 'SYSTEM_DESIGN', 'MANAGERIAL', 'HR'];
const SENIORITY = ['JUNIOR', 'MID', 'SENIOR', 'STAFF', 'PRINCIPAL'];
const WEEKDAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

export default function InterviewerProfile() {
  const { user } = useAuth();
  const zone = user?.timezone || 'UTC';

  const [profile, setProfile] = useState(null);
  const [windows, setWindows] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Skills editor
  const [skills, setSkills] = useState([]);
  const [newSkill, setNewSkill] = useState('');
  const [newProficiency, setNewProficiency] = useState(4);
  const [newYears, setNewYears] = useState(3);
  const [savingSkills, setSavingSkills] = useState(false);

  // Availability form
  const [date, setDate] = useState(DateTime.now().plus({ days: 1 }).toISODate());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [kind, setKind] = useState('AVAILABLE');
  const [savingWindow, setSavingWindow] = useState(false);

  // Preferences
  const [autoAccept, setAutoAccept] = useState(true);
  const [types, setTypes] = useState([]);
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Profile details + working hours
  const [details, setDetails] = useState({
    title: '', department: '', seniority: 'MID', yearsExperience: 0, bioText: '', phone: '',
  });
  const [hours, setHours] = useState({ start: '09:00', end: '18:00', weekdays: [1, 2, 3, 4, 5] });
  const [limits, setLimits] = useState({ maxInterviewsPerDay: 3, maxInterviewsPerWeek: 10 });
  const [savingDetails, setSavingDetails] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [me, avail, cat] = await Promise.all([
        api.get('/interviewers/me'),
        api.get('/interviewers/me/availability').catch(() => []),
        api.get('/users/skills').catch(() => []),
      ]);
      setProfile(me);
      setSkills(me.skills || []);
      setAutoAccept(me.autoAcceptEnabled !== false);
      setTypes(me.interviewTypes || []);
      setWindows(avail || []);
      setCatalog(cat || []);
      hydrateDetails(me);
    } catch (err) {
      setError(err.message || 'Could not load your interviewer profile');
    } finally {
      setLoading(false);
    }
  }

  function flash(msg) {
    setSuccess(msg);
    setError(null);
    setTimeout(() => setSuccess(null), 4000);
  }

  const minutesToHhmm = (m) =>
    `${String(Math.floor((m ?? 0) / 60)).padStart(2, '0')}:${String((m ?? 0) % 60).padStart(2, '0')}`;
  const hhmmToMinutes = (s) => {
    const [h, m] = String(s).split(':').map(Number);
    return h * 60 + (m || 0);
  };

  function hydrateDetails(me) {
    setDetails({
      title: me.title || '',
      department: me.department || '',
      seniority: me.seniority || 'MID',
      yearsExperience: me.yearsExperience ?? 0,
      bioText: me.bioText || '',
      phone: me.phone || '',
    });
    setHours({
      start: minutesToHhmm(me.workingHours?.startMinute ?? 540),
      end: minutesToHhmm(me.workingHours?.endMinute ?? 1080),
      weekdays: me.workingHours?.weekdays?.length ? me.workingHours.weekdays : [1, 2, 3, 4, 5],
    });
    setLimits({
      maxInterviewsPerDay: me.limits?.maxInterviewsPerDay ?? 3,
      maxInterviewsPerWeek: me.limits?.maxInterviewsPerWeek ?? 10,
    });
  }

  // ------------------------------------------- profile details + hours ----

  async function saveDetails(e) {
    e?.preventDefault();
    setSavingDetails(true);
    setError(null);
    try {
      const startMinute = hhmmToMinutes(hours.start);
      const endMinute = hhmmToMinutes(hours.end);
      if (endMinute <= startMinute) {
        setError('Working hours must end after they start');
        return;
      }
      if (!hours.weekdays.length) {
        setError('Pick at least one working day');
        return;
      }
      if (limits.maxInterviewsPerWeek < limits.maxInterviewsPerDay) {
        setError('The weekly limit cannot be lower than the daily limit');
        return;
      }
      const updated = await api.put('/interviewers/me', {
        phone: details.phone || null,
        title: details.title || null,
        department: details.department || null,
        seniority: details.seniority,
        yearsExperience: Number(details.yearsExperience) || 0,
        bioText: details.bioText || null,
        workingHours: { startMinute, endMinute, weekdays: hours.weekdays },
        limits: {
          maxInterviewsPerDay: Number(limits.maxInterviewsPerDay),
          maxInterviewsPerWeek: Number(limits.maxInterviewsPerWeek),
        },
      });
      setProfile(updated);
      hydrateDetails(updated);
      flash('Profile and working hours saved.');
    } catch (err) {
      setError(err.message || 'Failed to save your profile');
    } finally {
      setSavingDetails(false);
    }
  }

  function toggleWeekday(d) {
    setHours((h) => ({
      ...h,
      weekdays: h.weekdays.includes(d)
        ? h.weekdays.filter((x) => x !== d)
        : [...h.weekdays, d].sort((a, b) => a - b),
    }));
  }

  // ------------------------------------------------------------- skills ----

  function addSkill(e) {
    e.preventDefault();
    const name = newSkill.trim();
    if (!name) return;
    if (skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      setError(`"${name}" is already on your list`);
      return;
    }
    setSkills([
      ...skills,
      { name, proficiency: Number(newProficiency), yearsExperience: Number(newYears) },
    ]);
    setNewSkill('');
    setError(null);
  }

  async function saveSkills() {
    setSavingSkills(true);
    setError(null);
    try {
      const updated = await api.put('/interviewers/me', {
        skills: skills.map((s) => ({
          name: s.name,
          proficiency: Number(s.proficiency) || 3,
          yearsExperience: Number(s.yearsExperience) || 0,
        })),
      });
      setProfile(updated);
      setSkills(updated.skills || []);
      flash('Skills saved. The matcher will use these against every job description.');
    } catch (err) {
      setError(err.message || 'Failed to save skills');
    } finally {
      setSavingSkills(false);
    }
  }

  // ------------------------------------------------------- availability ----

  async function addWindow(e) {
    e.preventDefault();
    setSavingWindow(true);
    setError(null);
    try {
      const start = DateTime.fromISO(`${date}T${startTime}`, { zone });
      const end = DateTime.fromISO(`${date}T${endTime}`, { zone });
      if (end <= start) {
        setError('The end time must be after the start time');
        return;
      }
      await api.post('/interviewers/me/availability', {
        windows: [{ startUtc: start.toUTC().toISO(), endUtc: end.toUTC().toISO(), kind }],
        mode: 'append',
      });
      await refreshWindows();
      flash(
        kind === 'UNAVAILABLE'
          ? 'Blackout added. You will not be proposed for slots in that window.'
          : 'Availability added. Bookings inside it can be auto-accepted.'
      );
    } catch (err) {
      setError(err.message || 'Failed to add the window');
    } finally {
      setSavingWindow(false);
    }
  }

  async function refreshWindows() {
    const rows = await api.get('/interviewers/me/availability').catch(() => []);
    setWindows(rows || []);
  }

  async function removeWindow(id) {
    try {
      await api.del(`/interviewers/me/availability/${id}`);
      setWindows(windows.filter((w) => w.id !== id));
    } catch (err) {
      setError(err.message || 'Failed to remove the window');
    }
  }

  // -------------------------------------------------------- preferences ----

  async function savePrefs(nextAuto = autoAccept, nextTypes = types) {
    setSavingPrefs(true);
    setError(null);
    try {
      const updated = await api.put('/interviewers/me', {
        autoAcceptEnabled: nextAuto,
        ...(nextTypes.length ? { interviewTypes: nextTypes } : {}),
      });
      setProfile(updated);
      setAutoAccept(updated.autoAcceptEnabled !== false);
      setTypes(updated.interviewTypes || []);
      flash('Preferences saved.');
    } catch (err) {
      setError(err.message || 'Failed to save preferences');
      setAutoAccept(profile?.autoAcceptEnabled !== false);
    } finally {
      setSavingPrefs(false);
    }
  }

  function toggleType(t) {
    const next = types.includes(t) ? types.filter((x) => x !== t) : [...types, t];
    if (!next.length) {
      setError('Keep at least one interview type');
      return;
    }
    setTypes(next);
    savePrefs(autoAccept, next);
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <div className="h-8 w-8 rounded-full border-4 border-brand-600 border-t-transparent animate-spin mx-auto mb-3" />
        <p className="text-xs font-bold text-slate-600">Loading your profile...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16">
        <div className="card p-6 bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800">
          {error || 'No interviewer profile is linked to this account.'}
        </div>
      </div>
    );
  }

  const suggestions = catalog
    .filter((s) => !skills.some((x) => x.name.toLowerCase() === (s.name || '').toLowerCase()))
    .slice(0, 12);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Award className="h-6 w-6 text-brand-600" />
          My Interviewer Profile
        </h1>
        <p className="text-xs text-slate-600 mt-1">
          Declare the skills you can assess and the hours you are free. Both feed the matcher directly.
        </p>
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ---------------------------------------------------- skills --- */}
        <div className="lg:col-span-7 space-y-6">
          {/* ----------------------------------- profile + working hours --- */}
          <div className="card p-5 bg-white border border-sky-100 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
                  <Briefcase className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Profile & Working Hours</h3>
                  <p className="text-[11px] text-slate-500">
                    Working hours are the fallback when you have not declared specific windows
                  </p>
                </div>
              </div>
              <button
                onClick={saveDetails}
                disabled={savingDetails}
                className="btn-primary text-xs py-2 px-3.5 flex items-center gap-1.5"
              >
                <Save className="h-3.5 w-3.5" />
                {savingDetails ? 'Saving...' : 'Save'}
              </button>
            </div>

            <form onSubmit={saveDetails} className="grid grid-cols-12 gap-3">
              <div className="col-span-6">
                <label className="label text-[10px]">Job Title</label>
                <input
                  value={details.title}
                  onChange={(e) => setDetails({ ...details, title: e.target.value })}
                  placeholder="Senior Staff Engineer"
                  className="input text-xs"
                />
              </div>
              <div className="col-span-6">
                <label className="label text-[10px]">Department</label>
                <input
                  value={details.department}
                  onChange={(e) => setDetails({ ...details, department: e.target.value })}
                  placeholder="Core Platform"
                  className="input text-xs"
                />
              </div>

              <div className="col-span-6">
                <label className="label text-[10px]">Seniority</label>
                <select
                  value={details.seniority}
                  onChange={(e) => setDetails({ ...details, seniority: e.target.value })}
                  className="input text-xs cursor-pointer"
                >
                  {SENIORITY.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-6">
                <label className="label text-[10px]">Years of Experience</label>
                <input
                  type="number"
                  min="0"
                  max="60"
                  step="0.5"
                  value={details.yearsExperience}
                  onChange={(e) => setDetails({ ...details, yearsExperience: e.target.value })}
                  className="input text-xs"
                />
              </div>
              <div className="col-span-6">
                <label className="label text-[10px]">Contact Phone</label>
                <input
                  type="tel"
                  value={details.phone}
                  onChange={(e) => setDetails({ ...details, phone: e.target.value })}
                  placeholder="e.g. +91 98765 43210"
                  className="input text-xs"
                />
              </div>

              <div className="col-span-12">
                <label className="label text-[10px]">Short Bio</label>
                <textarea
                  value={details.bioText}
                  onChange={(e) => setDetails({ ...details, bioText: e.target.value })}
                  rows={2}
                  placeholder="What you focus on and what you like to assess..."
                  className="input text-xs resize-none"
                />
              </div>

              <div className="col-span-12 pt-2 border-t border-sky-100">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Standard Working Hours ({zone})
                </span>
              </div>

              <div className="col-span-3">
                <label className="label text-[10px]">Day starts</label>
                <input
                  type="time"
                  value={hours.start}
                  onChange={(e) => setHours({ ...hours, start: e.target.value })}
                  className="input text-xs"
                />
              </div>
              <div className="col-span-3">
                <label className="label text-[10px]">Day ends</label>
                <input
                  type="time"
                  value={hours.end}
                  onChange={(e) => setHours({ ...hours, end: e.target.value })}
                  className="input text-xs"
                />
              </div>
              <div className="col-span-3">
                <label className="label text-[10px]">Max / day</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={limits.maxInterviewsPerDay}
                  onChange={(e) => setLimits({ ...limits, maxInterviewsPerDay: e.target.value })}
                  className="input text-xs"
                />
              </div>
              <div className="col-span-3">
                <label className="label text-[10px]">Max / week</label>
                <input
                  type="number"
                  min="1"
                  max="40"
                  value={limits.maxInterviewsPerWeek}
                  onChange={(e) => setLimits({ ...limits, maxInterviewsPerWeek: e.target.value })}
                  className="input text-xs"
                />
              </div>

              <div className="col-span-12">
                <label className="label text-[10px]">Working days</label>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((d) => {
                    const on = hours.weekdays.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => toggleWeekday(d.value)}
                        className={`chip transition ${
                          on
                            ? 'bg-brand-100 text-brand-800 border-brand-200 font-bold'
                            : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </form>
          </div>

          <div className="card p-5 bg-white border border-sky-100 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-brand-100 text-brand-700">
                  <Award className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Skills I Can Interview For</h3>
                  <p className="text-[11px] text-slate-500">
                    Matched against each job description's required skills
                  </p>
                </div>
              </div>
              <button
                onClick={saveSkills}
                disabled={savingSkills}
                className="btn-primary text-xs py-2 px-3.5 flex items-center gap-1.5"
              >
                <Save className="h-3.5 w-3.5" />
                {savingSkills ? 'Saving...' : 'Save Skills'}
              </button>
            </div>

            <form onSubmit={addSkill} className="grid grid-cols-12 gap-2 mb-4">
              <div className="col-span-6">
                <label className="label text-[10px]">Skill</label>
                <input
                  value={newSkill}
                  onChange={(e) => setNewSkill(e.target.value)}
                  list="skill-catalog"
                  placeholder="e.g. System Design"
                  className="input text-xs"
                />
                <datalist id="skill-catalog">
                  {catalog.map((s) => (
                    <option key={s.id || s.name} value={s.name} />
                  ))}
                </datalist>
              </div>
              <div className="col-span-3">
                <label className="label text-[10px]">Proficiency</label>
                <select
                  value={newProficiency}
                  onChange={(e) => setNewProficiency(e.target.value)}
                  className="input text-xs cursor-pointer"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n} / 5</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label text-[10px]">Years</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={newYears}
                  onChange={(e) => setNewYears(e.target.value)}
                  className="input text-xs"
                />
              </div>
              <div className="col-span-1 flex items-end">
                <button type="submit" className="btn-secondary w-full text-xs py-2 px-0" title="Add skill">
                  <Plus className="h-4 w-4 mx-auto" />
                </button>
              </div>
            </form>

            {suggestions.length > 0 && (
              <div className="mb-4">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Quick add
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s.id || s.name}
                      onClick={() =>
                        setSkills([...skills, { name: s.name, proficiency: 4, yearsExperience: 3 }])
                      }
                      className="chip border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 transition"
                    >
                      + {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {skills.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 bg-sky-50/40 rounded-xl border border-dashed border-sky-100">
                No skills declared yet. Without these you will not be matched to any job.
              </div>
            ) : (
              <div className="space-y-2">
                {skills.map((s, idx) => (
                  <div
                    key={`${s.name}-${idx}`}
                    className="flex items-center gap-3 p-2.5 rounded-xl bg-sky-50/50 border border-sky-100"
                  >
                    <span className="font-bold text-xs text-slate-900 flex-1">{s.name}</span>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-500">Level</span>
                      <select
                        value={s.proficiency}
                        onChange={(e) => {
                          const next = [...skills];
                          next[idx] = { ...s, proficiency: Number(e.target.value) };
                          setSkills(next);
                        }}
                        className="input text-[11px] py-1 px-1.5 w-16 cursor-pointer"
                        title={`Proficiency for ${s.name}`}
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-500">Yrs</span>
                      <input
                        type="number"
                        min="0"
                        max="50"
                        value={s.yearsExperience ?? 0}
                        onChange={(e) => {
                          const next = [...skills];
                          next[idx] = { ...s, yearsExperience: Number(e.target.value) };
                          setSkills(next);
                        }}
                        className="input text-[11px] py-1 px-1.5 w-14"
                        title={`Years of experience with ${s.name}`}
                      />
                    </div>

                    <button
                      onClick={() => setSkills(skills.filter((_, i) => i !== idx))}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                      title={`Remove ${s.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ------------------------------------------- add availability --- */}
          <div className="card p-5 bg-white border border-sky-100 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-1.5">
              <Plus className="h-4 w-4 text-brand-600" />
              Declare a Time Window
            </h3>

            <form onSubmit={addWindow} className="grid grid-cols-12 gap-2 text-xs">
              <div className="col-span-4">
                <label className="label text-[10px]">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input text-xs"
                  required
                />
              </div>
              <div className="col-span-2">
                <label className="label text-[10px]">From</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="input text-xs"
                  required
                />
              </div>
              <div className="col-span-2">
                <label className="label text-[10px]">To</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="input text-xs"
                  required
                />
              </div>
              <div className="col-span-4">
                <label className="label text-[10px]">Type</label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="input text-xs cursor-pointer"
                >
                  <option value="AVAILABLE">Available</option>
                  <option value="PREFERRED">Preferred (ranked higher)</option>
                  <option value="UNAVAILABLE">Unavailable / blackout</option>
                </select>
              </div>
              <div className="col-span-12">
                <button
                  type="submit"
                  disabled={savingWindow}
                  className="btn-secondary w-full text-xs py-2 mt-1"
                >
                  {savingWindow ? 'Saving...' : 'Add Window'}
                </button>
              </div>
            </form>

            <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
              Times are entered in your own timezone ({zone}) and stored in UTC.
            </p>
          </div>
        </div>

        {/* ----------------------------------------------- right column --- */}
        <div className="lg:col-span-5 space-y-6">
          <TimezoneCard note="Windows below are entered and displayed in this zone." />

          {/* auto-accept */}
          <div className="card p-5 bg-white border border-sky-100 shadow-sm">
            <div className="flex items-start gap-2 mb-3">
              <div className="p-2 rounded-lg bg-amber-100 text-amber-700">
                <Zap className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Auto-Accept Bookings</h3>
                <p className="text-[11px] text-slate-500">
                  Skip the approval step when the slot is already declared free
                </p>
              </div>
            </div>

            <label className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-50/60 border border-amber-100 cursor-pointer">
              <input
                type="checkbox"
                checked={autoAccept}
                onChange={(e) => {
                  setAutoAccept(e.target.checked);
                  savePrefs(e.target.checked, types);
                }}
                disabled={savingPrefs}
                className="mt-0.5 h-4 w-4 accent-amber-600 cursor-pointer"
              />
              <span className="text-[11px] text-amber-900 leading-relaxed">
                <strong className="block text-xs mb-0.5">
                  {autoAccept ? 'On' : 'Off'} — accept automatically
                </strong>
                When a booking lands inside a window you declared{' '}
                <strong>Available</strong> or <strong>Preferred</strong>, it is accepted on your
                behalf and the interview is scheduled immediately. Bookings that only fall inside
                your default working hours still ask you first.
              </span>
            </label>
          </div>

          {/* interview types */}
          <div className="card p-5 bg-white border border-sky-100 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-brand-600" />
              Rounds I Can Run
            </h3>
            <p className="text-[11px] text-slate-500 mb-3">
              You are only proposed for these interview types.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {INTERVIEW_TYPES.map((t) => {
                const on = types.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => toggleType(t)}
                    disabled={savingPrefs}
                    className={`chip transition ${
                      on
                        ? 'bg-brand-100 text-brand-800 border-brand-200 font-bold'
                        : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {t.replace('_', ' ')}
                  </button>
                );
              })}
            </div>
          </div>

          {/* declared windows */}
          <div className="card p-5 bg-white border border-sky-100 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-brand-600" />
              Declared Windows ({windows.length})
            </h3>

            {windows.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 bg-sky-50/40 rounded-xl border border-dashed border-sky-100">
                Nothing declared. Your default working hours will be used instead — and
                auto-accept will not apply.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                {windows.map((w) => {
                  const start = DateTime.fromISO(w.startUtc, { zone });
                  const end = DateTime.fromISO(w.endUtc, { zone });
                  return (
                    <div
                      key={w.id}
                      className="flex items-center gap-2 p-2.5 rounded-xl bg-sky-50/50 border border-sky-100"
                    >
                      <Clock className="h-3.5 w-3.5 text-brand-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="block text-[11px] font-bold text-slate-900">
                          {start.toFormat('ccc, LLL dd')}
                        </span>
                        <span className="block text-[10px] text-slate-500">
                          {start.toFormat('HH:mm')} – {end.toFormat('HH:mm')}
                        </span>
                      </div>
                      <span className={`chip ${KIND_STYLES[w.kind] || 'chip-blue'}`}>{w.kind}</span>
                      <button
                        onClick={() => removeWindow(w.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition shrink-0"
                        title="Remove this window"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
