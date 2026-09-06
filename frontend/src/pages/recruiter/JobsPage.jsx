import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import {
  Briefcase,
  Plus,
  CheckCircle2,
  AlertCircle,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'];

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // form state
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [location, setLocation] = useState('');
  const [employmentType, setEmploymentType] = useState('FULL_TIME');
  const [experienceMin, setExperienceMin] = useState(3);
  const [experienceMax, setExperienceMax] = useState(8);
  const [description, setDescription] = useState('');
  const [skills, setSkills] = useState([]);
  const [newSkill, setNewSkill] = useState('');
  const [newWeight, setNewWeight] = useState(0.8);
  const [newMustHave, setNewMustHave] = useState(true);

  // attach-candidate state
  const [attachJobId, setAttachJobId] = useState(null);
  const [attachCandidateId, setAttachCandidateId] = useState('');
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [jobList, candRes] = await Promise.all([
        api.get('/jobs'),
        api.get('/candidates?take=100').catch(() => ({ items: [] })),
      ]);
      setJobs(jobList || []);
      setCandidates(candRes?.items || []);
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
    setDepartment('');
    setLocation('');
    setEmploymentType('FULL_TIME');
    setExperienceMin(3);
    setExperienceMax(8);
    setDescription('');
    setSkills([]);
  }

  async function createJob(e) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        description: description.trim(),
        employmentType,
        ...(department.trim() ? { department: department.trim() } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(experienceMin !== '' ? { experienceMin: Number(experienceMin) } : {}),
        ...(experienceMax !== '' ? { experienceMax: Number(experienceMax) } : {}),
        ...(skills.length ? { requiredSkills: skills } : {}),
      };
      const res = await api.post('/jobs', body);
      flash(
        `Job "${res.job.title}" created with ${res.job.requiredSkills?.length ?? 0} required skill(s).`
      );
      resetForm();
      setShowForm(false);
      await loadAll();
    } catch (err) {
      setError(err.message || 'Failed to create the job');
    } finally {
      setCreating(false);
    }
  }

  async function attachCandidate(e) {
    e.preventDefault();
    if (!attachJobId || !attachCandidateId) return;
    setAttaching(true);
    setError(null);
    try {
      await api.post(`/jobs/${attachJobId}/applications`, { candidateId: attachCandidateId });
      flash('Candidate added to the role. They now appear on the recruiter dashboard for this job.');
      setAttachJobId(null);
      setAttachCandidateId('');
      await loadAll();
    } catch (err) {
      setError(err.message || 'Failed to add the candidate');
    } finally {
      setAttaching(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Top Banner */}
      <div className="card p-6 bg-gradient-to-r from-purple-50 via-white to-sky-50/50 border border-sky-100 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center font-extrabold text-lg shadow-sm">
              <Briefcase className="h-6 w-6" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-purple-800 bg-purple-100/70 px-2.5 py-0.5 rounded-full border border-purple-200">
                Job Requisitions
              </span>
              <h1 className="text-2xl font-extrabold text-slate-900 mt-1">
                Open Roles & Requisitions
              </h1>
            </div>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5 shrink-0 font-bold self-start sm:self-auto"
          >
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? 'Cancel' : 'Post New Role'}
          </button>
        </div>
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

      {/* -------------------------------------------------- create form --- */}
      {showForm && (
        <div className="card p-6 bg-white border border-sky-100 shadow-sm mb-6 animate-fade-in">
          <h2 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-1.5">
            <Plus className="h-4 w-4 text-purple-600" />
            Post a New Role
          </h2>

          <form onSubmit={createJob} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-5">
                <label className="label text-[10px]">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Senior Backend Engineer"
                  className="input text-xs font-medium"
                  required
                  minLength={2}
                />
              </div>
              <div className="md:col-span-4">
                <label className="label text-[10px]">Department</label>
                <input
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="Core Platform"
                  className="input text-xs font-medium"
                />
              </div>
              <div className="md:col-span-3">
                <label className="label text-[10px]">Location</label>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Bengaluru, India"
                  className="input text-xs font-medium"
                />
              </div>

              <div className="md:col-span-4">
                <label className="label text-[10px]">Employment Type</label>
                <select
                  value={employmentType}
                  onChange={(e) => setEmploymentType(e.target.value)}
                  className="input text-xs cursor-pointer font-medium"
                >
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-4">
                <label className="label text-[10px]">Min Experience (yrs)</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={experienceMin}
                  onChange={(e) => setExperienceMin(e.target.value)}
                  className="input text-xs font-medium"
                />
              </div>
              <div className="md:col-span-4">
                <label className="label text-[10px]">Max Experience (yrs)</label>
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={experienceMax}
                  onChange={(e) => setExperienceMax(e.target.value)}
                  className="input text-xs font-medium"
                />
              </div>
            </div>

            <div>
              <label className="label text-[10px]">
                Job Description <span className="text-slate-400">(min 20 characters)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="Describe the role, the stack, and what the person will own..."
                className="input text-xs leading-relaxed resize-none font-normal"
                required
                minLength={20}
              />
            </div>

            {/* skills */}
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block mb-2">
                Required Skills <span className="text-purple-600">*</span>
              </span>

              <div className="grid grid-cols-12 gap-2 mb-3">
                <div className="col-span-5">
                  <input
                    value={newSkill}
                    onChange={(e) => setNewSkill(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addSkill(e)}
                    placeholder="Add a skill..."
                    className="input text-xs font-medium"
                  />
                </div>
                <div className="col-span-3">
                  <select
                    value={newWeight}
                    onChange={(e) => setNewWeight(e.target.value)}
                    className="input text-xs cursor-pointer font-medium"
                    title="Weight of this skill in matching"
                  >
                    <option value={1}>Weight 1.0 — critical</option>
                    <option value={0.8}>Weight 0.8 — high</option>
                    <option value={0.5}>Weight 0.5 — medium</option>
                    <option value={0.3}>Weight 0.3 — nice to have</option>
                  </select>
                </div>
                <div className="col-span-3">
                  <select
                    value={newMustHave ? 'yes' : 'no'}
                    onChange={(e) => setNewMustHave(e.target.value === 'yes')}
                    className="input text-xs cursor-pointer font-medium"
                    title="Whether this skill is mandatory"
                  >
                    <option value="yes">Must have</option>
                    <option value="no">Nice to have</option>
                  </select>
                </div>
                <div className="col-span-1">
                  <button
                    type="button"
                    onClick={addSkill}
                    className="btn-secondary w-full text-xs py-2 px-0 font-bold"
                    title="Add skill"
                  >
                    <Plus className="h-4 w-4 mx-auto" />
                  </button>
                </div>
              </div>

              {skills.length === 0 ? (
                <p className="text-[11px] text-slate-400 font-medium">
                  No skills added yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((s, idx) => (
                    <span
                      key={`${s.name}-${idx}`}
                      className="chip flex items-center gap-1.5 border-purple-200 bg-purple-50 text-purple-700 font-semibold"
                    >
                      {s.name}
                      <span className="opacity-60">{s.weight}</span>
                      <button
                        type="button"
                        onClick={() => setSkills(skills.filter((_, i) => i !== idx))}
                        className="text-purple-400 hover:text-purple-800"
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
              <button
                type="button"
                onClick={() => { resetForm(); setShowForm(false); }}
                className="btn-secondary text-xs py-2 px-4 font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5 font-bold shadow-sm"
              >
                {creating ? 'Creating...' : 'Create Job'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* -------------------------------------------------------- list --- */}
      {loading ? (
        <div className="py-16 text-center">
          <div className="h-8 w-8 rounded-full border-4 border-purple-600 border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-xs font-bold text-slate-700">Loading jobs...</p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="card p-12 text-center bg-white border border-sky-100">
          <Briefcase className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-900">No jobs yet</p>
          <p className="text-xs text-slate-500 mt-1">
            Create one to define the skills interviewers get matched against.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {jobs.map((job) => (
            <div key={job.id} className="card p-5 bg-white border border-sky-100 hover:border-sky-200 shadow-sm transition">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-slate-900 truncate">{job.title}</h3>
                  <p className="text-xs text-slate-500 font-medium">
                    {job.department || 'General'}
                    {job.location ? ` • ${job.location}` : ''}
                    {job.recruiter?.name ? ` • ${job.recruiter.name}` : ''}
                  </p>
                </div>
                <span className={`chip shrink-0 ${job.status === 'OPEN' ? 'chip-green' : 'border-slate-200 bg-slate-100 text-slate-700'}`}>
                  {job.status}
                </span>
              </div>

              <p className="text-xs text-slate-600 line-clamp-2 mb-3 leading-relaxed">{job.description}</p>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {(job.requiredSkills || []).length === 0 ? (
                  <span className="text-[11px] text-slate-400 font-medium">No required skills set</span>
                ) : (
                  job.requiredSkills.map((s, i) => (
                    <span
                      key={`${s.name}-${i}`}
                      className="chip chip-blue text-[11px]"
                      title={`Weight ${s.weight}${s.mustHave ? ' • must have' : ''}`}
                    >
                      {s.name}
                    </span>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <span className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-purple-600" />
                  {job.applicationCount ?? 0} applicant(s)
                </span>
                <button
                  onClick={() => {
                    setAttachJobId(attachJobId === job.id ? null : job.id);
                    setAttachCandidateId('');
                  }}
                  className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1 font-bold"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Add Candidate
                </button>
              </div>

              {attachJobId === job.id && (
                <form onSubmit={attachCandidate} className="mt-3 flex gap-2 animate-fade-in">
                  <select
                    value={attachCandidateId}
                    onChange={(e) => setAttachCandidateId(e.target.value)}
                    className="input text-xs cursor-pointer flex-1 font-medium"
                    required
                    title="Select a candidate to add to this job"
                  >
                    <option value="">Select a candidate...</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.candidateNumber} — {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={attaching}
                    className="btn-primary text-xs py-2 px-3.5 shrink-0 font-bold"
                  >
                    {attaching ? 'Adding...' : 'Add'}
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
