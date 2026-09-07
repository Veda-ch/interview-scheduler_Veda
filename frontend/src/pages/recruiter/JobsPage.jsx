import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { Briefcase, Plus, CheckCircle2, AlertCircle, Users, X, CalendarRange, Pencil } from 'lucide-react';
import { DateTime } from 'luxon';

/**
 * Jobs, their required skills, and the window their interviews must run inside.
 *
 * Candidates are not attached here - they arrive from the seeded database
 * already applied to a job. This page owns two things: the skills interviewers
 * are matched against, and the date window every round for the role inherits.
 */
const iso = (d, endOfDay = false) =>
  d ? DateTime.fromISO(d, { zone: 'utc' })[endOfDay ? 'endOf' : 'startOf']('day').toISO() : null;
const toDateInput = (v) => (v ? DateTime.fromISO(v, { zone: 'utc' }).toISODate() : '');

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // create form
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [windowStart, setWindowStart] = useState(DateTime.now().plus({ days: 1 }).toISODate());
  const [windowEnd, setWindowEnd] = useState(DateTime.now().plus({ days: 21 }).toISODate());
  const [skills, setSkills] = useState([]);
  const [newSkill, setNewSkill] = useState('');
  const [newWeight, setNewWeight] = useState(0.8);
  const [newMustHave, setNewMustHave] = useState(true);

  // inline window editing
  const [editingId, setEditingId] = useState(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [savingWindow, setSavingWindow] = useState(false);

  useEffect(() => {
    loadJobs();
  }, []);

  async function loadJobs() {
    setLoading(true);
    try {
      setJobs((await api.get('/jobs')) || []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }

  function flash(msg) {
    setSuccess(msg);
    setError(null);
    setTimeout(() => setSuccess(null), 5000);
  }

  function addSkill(e) {
    e.preventDefault();
    const name = newSkill.trim();
    if (!name) return;
    if (skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      setError(`"${name}" is already listed`);
      return;
    }
    setSkills([...skills, { name, weight: Number(newWeight), mustHave: newMustHave }]);
    setNewSkill('');
    setError(null);
  }

  function resetForm() {
    setTitle('');
    setDescription('');
    setSkills([]);
    setNewSkill('');
    setWindowStart(DateTime.now().plus({ days: 1 }).toISODate());
    setWindowEnd(DateTime.now().plus({ days: 21 }).toISODate());
  }

  async function createJob(e) {
    e.preventDefault();
    if (!skills.length) {
      setError('Add at least one required skill - this is what interviewers are matched against.');
      return;
    }
    if (!windowStart || !windowEnd) {
      setError('Please provide both a start date and an end date for the interview window.');
      return;
    }
    if (DateTime.fromISO(windowEnd) < DateTime.fromISO(windowStart)) {
      setError('The interview window must end on or after it starts.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await api.post('/jobs', {
        title: title.trim(),
        description: description.trim(),
        requiredSkills: skills,
        interviewWindowStart: iso(windowStart),
        interviewWindowEnd: iso(windowEnd, true),
      });
      flash(`"${res.job.title}" created with ${res.job.requiredSkills?.length ?? 0} required skill(s).`);
      resetForm();
      setShowForm(false);
      await loadJobs();
    } catch (err) {
      setError(err.message || 'Failed to create the job');
    } finally {
      setCreating(false);
    }
  }

  function startEditing(job) {
    setEditingId(job.id);
    setEditStart(toDateInput(job.interviewWindowStart));
    setEditEnd(toDateInput(job.interviewWindowEnd));
    setError(null);
  }

  async function saveWindow(jobId) {
    if (!editStart || !editEnd) {
      setError('Please provide both a start date and an end date.');
      return;
    }
    if (DateTime.fromISO(editEnd) < DateTime.fromISO(editStart)) {
      setError('The interview window must end on or after it starts.');
      return;
    }
    setSavingWindow(true);
    setError(null);
    try {
      await api.put(`/jobs/${jobId}`, {
        interviewWindowStart: iso(editStart),
        interviewWindowEnd: iso(editEnd, true),
      });
      flash('Interview window updated. New rounds for this role will use it.');
      setEditingId(null);
      await loadJobs();
    } catch (err) {
      setError(err.message || 'Failed to update the window');
    } finally {
      setSavingWindow(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 animate-fade-in">
      {/* Top Banner */}
      <div className="card p-5 bg-white border border-gray-200 shadow-2xs mb-6 rounded-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
              <Briefcase className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900">Jobs &amp; Requisitions</h1>
                <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                  Role Management
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Required skills drive interviewer matching. Date windows define valid interview scheduling ranges.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="btn-primary text-xs py-1.5 px-3.5 flex items-center gap-1.5 shrink-0 font-semibold rounded-md shadow-2xs self-start sm:self-auto"
          >
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? 'Cancel' : 'New Job'}
          </button>
        </div>
      </div>

      {success && (
        <div className="mb-6 p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2 animate-fade-in shadow-2xs">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{success}</span>
        </div>
      )}
      {error && (
        <div className="mb-6 p-4 rounded-lg bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center gap-2 animate-fade-in shadow-2xs">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ---------------------------------------------------- create form --- */}
      {showForm && (
        <div className="card p-6 bg-white border border-gray-200 shadow-2xs mb-6 rounded-lg animate-fade-in">
          <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-1.5">
            <Plus className="h-4 w-4 text-indigo-600" />
            Create a Job
          </h2>

          <form onSubmit={createJob} className="space-y-4">
            <div>
              <label className="label">Job Name</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Senior Backend Engineer"
                className="input text-sm rounded-md"
                required
                minLength={2}
              />
            </div>

            <div>
              <label className="label">
                Description <span className="text-gray-400 font-medium normal-case">(min 20 characters)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="What the role covers and what the person will own..."
                className="input text-sm leading-relaxed resize-none rounded-md"
                required
                minLength={20}
              />
            </div>

            <div className="p-4 rounded-md bg-gray-50 border border-gray-200">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1.5 mb-1">
                <CalendarRange className="h-4 w-4 text-indigo-600" />
                Interview Window
              </span>
              <p className="text-[11px] text-gray-500 mb-3">
                Every interview for this role must fall inside these dates. Candidates can only offer
                times within the window.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-[10px]">Earliest date</label>
                  <input
                    type="date"
                    value={windowStart}
                    onChange={(e) => setWindowStart(e.target.value)}
                    className="input text-sm rounded-md"
                    required
                  />
                </div>
                <div>
                  <label className="label text-[10px]">Latest date</label>
                  <input
                    type="date"
                    value={windowEnd}
                    onChange={(e) => setWindowEnd(e.target.value)}
                    className="input text-sm rounded-md"
                    required
                  />
                </div>
              </div>
            </div>

            {/* skills */}
            <div className="p-4 rounded-md bg-gray-50 border border-gray-200">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-700 block mb-2">
                Required Skills <span className="text-rose-600">*</span>
              </span>

              <div className="grid grid-cols-12 gap-2 mb-3">
                <div className="col-span-5">
                  <input
                    value={newSkill}
                    onChange={(e) => setNewSkill(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addSkill(e)}
                    placeholder="Add a skill..."
                    className="input text-sm rounded-md"
                  />
                </div>
                <div className="col-span-3">
                  <select
                    value={newWeight}
                    onChange={(e) => setNewWeight(e.target.value)}
                    className="input text-sm cursor-pointer rounded-md"
                    title="How heavily this skill counts when ranking interviewers"
                  >
                    <option value={1}>Weight 1.0</option>
                    <option value={0.8}>Weight 0.8</option>
                    <option value={0.5}>Weight 0.5</option>
                    <option value={0.3}>Weight 0.3</option>
                  </select>
                </div>
                <div className="col-span-3">
                  <select
                    value={newMustHave ? 'yes' : 'no'}
                    onChange={(e) => setNewMustHave(e.target.value === 'yes')}
                    className="input text-sm cursor-pointer rounded-md"
                    title="Whether an interviewer must cover this skill"
                  >
                    <option value="yes">Must have</option>
                    <option value="no">Nice to have</option>
                  </select>
                </div>
                <div className="col-span-1">
                  <button type="button" onClick={addSkill} className="btn-secondary w-full py-2 px-0 rounded-md" title="Add skill">
                    <Plus className="h-4 w-4 mx-auto" />
                  </button>
                </div>
              </div>

              {skills.length === 0 ? (
                <p className="text-[11px] text-gray-400 font-medium">No skills added yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((s, idx) => (
                    <span
                      key={`${s.name}-${idx}`}
                      className={`chip ${s.mustHave ? 'chip-purple' : 'border-gray-200 bg-gray-100 text-gray-700'}`}
                    >
                      {s.name}
                      <span className="opacity-60">{s.weight}</span>
                      <button
                        type="button"
                        onClick={() => setSkills(skills.filter((_, i) => i !== idx))}
                        className="hover:text-rose-600"
                        title={`Remove ${s.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="px-3.5 py-1.5 rounded-md border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition">
                Cancel
              </button>
              <button type="submit" disabled={creating} className="btn-primary text-xs py-1.5 px-4 font-semibold rounded-md shadow-2xs">
                {creating ? 'Creating...' : 'Create Job'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---------------------------------------------------------- list --- */}
      {loading ? (
        <div className="py-16 text-center">
          <div className="h-8 w-8 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-xs font-semibold text-gray-700">Loading jobs...</p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="card p-12 text-center bg-white border border-gray-200 rounded-lg shadow-2xs">
          <Briefcase className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-gray-900">No jobs yet</p>
          <p className="text-xs text-gray-500 mt-1 font-medium">
            Create one to define the skills interviewers get matched against.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {jobs.map((job) => {
            const hasWindow = job.interviewWindowStart && job.interviewWindowEnd;
            const editing = editingId === job.id;
            return (
              <div key={job.id} className="card p-5 bg-white border border-gray-200 shadow-2xs rounded-lg">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="text-sm font-bold text-gray-900">{job.title}</h3>
                  <span className={`chip shrink-0 ${job.status === 'OPEN' ? 'chip-green' : 'chip-amber'}`}>
                    {job.status}
                  </span>
                </div>

                <p className="text-xs text-gray-600 leading-relaxed mb-3">{job.description}</p>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {(job.requiredSkills || []).length === 0 ? (
                    <span className="text-[11px] text-gray-400 font-medium">No required skills set</span>
                  ) : (
                    job.requiredSkills.map((s, i) => (
                      <span
                        key={`${s.name}-${i}`}
                        className={`chip ${s.mustHave ? 'chip-purple' : 'border-gray-200 bg-gray-100 text-gray-600'}`}
                        title={`Weight ${s.weight}${s.mustHave ? ' • must have' : ' • nice to have'}`}
                      >
                        {s.name}
                      </span>
                    ))
                  )}
                </div>

                {/* interview window */}
                <div className="p-3 rounded-md bg-gray-50 border border-gray-200 mb-3">
                  {editing ? (
                    <div className="space-y-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-1.5">
                        <CalendarRange className="h-3.5 w-3.5 text-indigo-600" /> Interview Window
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-gray-500 font-medium block mb-0.5">Earliest Date</label>
                          <input type="date" value={editStart} onChange={(e) => setEditStart(e.target.value)} className="input text-xs py-1.5 rounded-md w-full" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 font-medium block mb-0.5">Latest Date</label>
                          <input type="date" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} className="input text-xs py-1.5 rounded-md w-full" />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button onClick={() => setEditingId(null)} className="px-3 py-1 rounded-md border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition">
                          Cancel
                        </button>
                        <button
                          onClick={() => saveWindow(job.id)}
                          disabled={savingWindow}
                          className="btn-primary text-xs py-1 px-3 font-semibold rounded-md shadow-2xs"
                        >
                          {savingWindow ? 'Saving...' : 'Save Window'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] flex items-center gap-1.5 min-w-0">
                        <CalendarRange className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                        {hasWindow ? (
                          <span className="text-gray-700 font-medium truncate">
                            {DateTime.fromISO(job.interviewWindowStart, { zone: 'utc' }).toFormat('LLL dd')} –{' '}
                            {DateTime.fromISO(job.interviewWindowEnd, { zone: 'utc' }).toFormat('LLL dd, yyyy')}
                          </span>
                        ) : (
                          <span className="text-amber-700 font-semibold">
                            No interview window — rounds cannot be raised
                          </span>
                        )}
                      </span>
                      <button
                        onClick={() => startEditing(job)}
                        className="btn-ghost text-[11px] py-1 px-2 flex items-center gap-1 shrink-0 text-gray-600 hover:text-gray-900"
                      >
                        <Pencil className="h-3 w-3" /> {hasWindow ? 'Edit' : 'Set'}
                      </button>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-gray-100">
                  <span className="text-[11px] text-gray-500 font-medium flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-indigo-600" />
                    {job.applicationCount ?? 0} candidate(s) applied
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
