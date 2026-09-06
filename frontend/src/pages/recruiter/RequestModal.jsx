import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import {
  X,
  Plus,
  Trash2,
  Calendar,
  Clock,
  Briefcase,
  User,
  Shield,
  CheckCircle2,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { DateTime } from 'luxon';

const INTERVIEW_TYPES = [
  { value: 'TECHNICAL', label: 'Technical Interview' },
  { value: 'CODING', label: 'Coding / Live Programming' },
  { value: 'SYSTEM_DESIGN', label: 'System Design & Architecture' },
  { value: 'MANAGERIAL', label: 'Managerial & Cultural Fit' },
  { value: 'HR', label: 'HR & Screening' },
];

export default function RequestModal({ isOpen, onClose, onSuccess, initialApplicationId = null }) {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Form State
  const [applicationId, setApplicationId] = useState('');
  const [roundName, setRoundName] = useState('Technical Round 1');
  const [interviewType, setInterviewType] = useState('TECHNICAL');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [requiredInterviewerCount, setRequiredInterviewerCount] = useState(1);
  const [bufferMinutes, setBufferMinutes] = useState(15);
  const [priority, setPriority] = useState('NORMAL');
  const [earliestDate, setEarliestDate] = useState(
    DateTime.now().plus({ days: 1 }).toISODate()
  );
  const [latestDate, setLatestDate] = useState(
    DateTime.now().plus({ days: 8 }).toISODate()
  );

  // Skills
  const [skills, setSkills] = useState([
    { name: 'Java', weight: 0.9, mustHave: true },
    { name: 'Spring Boot', weight: 0.8, mustHave: true },
    { name: 'SQL', weight: 0.7, mustHave: false },
  ]);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillWeight, setNewSkillWeight] = useState(0.8);

  useEffect(() => {
    if (isOpen) {
      loadApplications();
    }
  }, [isOpen, initialApplicationId]);

  async function loadApplications() {
    setLoading(true);
    try {
      const res = await api.get('/candidates?take=50');
      const candidateList = res?.items || res || [];
      const apps = [];
      for (const c of candidateList) {
        const num = c.candidateNumber || `CND-${(c.id || '').slice(-4).toUpperCase()}`;
        if (c.applications && c.applications.length) {
          for (const app of c.applications) {
            apps.push({
              id: app.id,
              candidateNumber: num,
              candidateName: c.name,
              candidateId: c.id,
              jobTitle: app.jobTitle || app.job?.title || c.headline || 'Engineer',
              skills: c.skills?.map((s) => s.name || s.skill?.name) || [],
            });
          }
        }
      }
      setApplications(apps);

      const targetId = initialApplicationId || (apps.length > 0 ? apps[0].id : '');
      if (targetId) {
        setApplicationId(targetId);
        const selected = apps.find((a) => a.id === targetId);
        if (selected && selected.skills?.length) {
          setSkills(
            selected.skills.slice(0, 4).map((s) => ({ name: s, weight: 0.8, mustHave: true }))
          );
        }
      }
    } catch (err) {
      console.error('Failed to load applications:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleApplicationChange(appId) {
    setApplicationId(appId);
    const selected = applications.find((a) => a.id === appId);
    if (selected && selected.skills?.length) {
      setSkills(
        selected.skills.slice(0, 4).map((s) => ({ name: s, weight: 0.8, mustHave: true }))
      );
    }
  }

  function addSkill() {
    if (!newSkillName.trim()) return;
    setSkills([...skills, { name: newSkillName.trim(), weight: Number(newSkillWeight), mustHave: true }]);
    setNewSkillName('');
  }

  function updateSkillWeight(idx, weight) {
    const updated = [...skills];
    updated[idx] = { ...updated[idx], weight: Number(weight) };
    setSkills(updated);
  }

  function removeSkill(idx) {
    setSkills(skills.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!applicationId) {
      setError('Please select an active candidate application');
      return;
    }

    setSubmitting(true);
    setError(null);

    const earliestUtc = DateTime.fromISO(earliestDate).startOf('day').toISO();
    const latestUtc = DateTime.fromISO(latestDate).endOf('day').toISO();

    try {
      const payload = {
        applicationId,
        roundNumber: roundName.includes('2') ? 2 : roundName.includes('3') ? 3 : 1,
        roundName,
        interviewType,
        durationMinutes: Number(durationMinutes),
        requiredInterviewerCount: Number(requiredInterviewerCount),
        bufferMinutes: Number(bufferMinutes),
        earliestUtc,
        latestUtc,
        priority,
        requiredSkills: skills,
      };

      const result = await api.post('/interview-requests', payload);
      onSuccess?.(result);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create interview request');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-sky-100 overflow-hidden animate-fade-in my-8">
        {/* Header */}
        <div className="px-6 py-4 border-b border-sky-100 bg-sky-50/70 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-brand-600 text-white shadow-sm shadow-brand-500/20">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Create Interview Request</h3>
              <p className="text-xs text-slate-500">
                Minimum Deliverable 1 • Setup round criteria, duration, buffer & skill constraints
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Candidate & Application Picker */}
          <div>
            <label className="label">Select Candidate Application *</label>
            {loading ? (
              <div className="text-xs text-slate-400 py-2">Loading applications...</div>
            ) : (
              <select
                value={applicationId}
                onChange={(e) => handleApplicationChange(e.target.value)}
                className="input cursor-pointer font-medium"
                required
              >
                {applications.map((app) => (
                  <option key={app.id} value={app.id}>
                    [{app.candidateNumber}] {app.candidateName} — {app.jobTitle} (Waiting for Request)
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Round Name */}
            <div>
              <label className="label">Round Name *</label>
              <input
                type="text"
                value={roundName}
                onChange={(e) => setRoundName(e.target.value)}
                className="input"
                placeholder="e.g. Technical Round 1"
                required
              />
            </div>

            {/* Interview Type */}
            <div>
              <label className="label">Interview Round Type *</label>
              <select
                value={interviewType}
                onChange={(e) => setInterviewType(e.target.value)}
                className="input cursor-pointer"
              >
                {INTERVIEW_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Duration, Buffer & Panel Size */}
          <div className="grid grid-cols-3 gap-3 p-3.5 rounded-xl bg-sky-50/50 border border-sky-100">
            <div>
              <label className="label text-[11px]">Duration (Min)</label>
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-sky-600 shrink-0" />
                <select
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  className="input py-1.5 text-xs font-semibold"
                >
                  <option value="30">30 min</option>
                  <option value="45">45 min</option>
                  <option value="60">60 min (1h)</option>
                  <option value="90">90 min (1.5h)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label text-[11px]">Buffer Time</label>
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-amber-600 shrink-0" />
                <select
                  value={bufferMinutes}
                  onChange={(e) => setBufferMinutes(e.target.value)}
                  className="input py-1.5 text-xs font-semibold"
                >
                  <option value="0">0 min</option>
                  <option value="15">15 min</option>
                  <option value="30">30 min</option>
                  <option value="45">45 min</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label text-[11px]">Required Panelists</label>
              <div className="flex items-center gap-1.5">
                <User className="h-4 w-4 text-purple-600 shrink-0" />
                <select
                  value={requiredInterviewerCount}
                  onChange={(e) => setRequiredInterviewerCount(e.target.value)}
                  className="input py-1.5 text-xs font-semibold"
                >
                  <option value="1">1 Interviewer</option>
                  <option value="2">2 Panelists</option>
                  <option value="3">3 Panelists</option>
                </select>
              </div>
            </div>
          </div>

          {/* Date Range Window */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Earliest Feasible Date *</label>
              <input
                type="date"
                value={earliestDate}
                onChange={(e) => setEarliestDate(e.target.value)}
                className="input cursor-pointer"
                required
              />
            </div>
            <div>
              <label className="label">Latest Feasible Date *</label>
              <input
                type="date"
                value={latestDate}
                onChange={(e) => setLatestDate(e.target.value)}
                className="input cursor-pointer"
                required
              />
            </div>
          </div>

          {/* Skills Requirements for Intelligent Matching */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Required Skills for Interviewer Match</label>
              <span className="text-[11px] text-slate-400">Weights used by solver</span>
            </div>
            <div className="flex flex-wrap gap-2 mb-2.5">
              {skills.map((s, idx) => (
                <div
                  key={idx}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-xs font-semibold text-slate-800"
                >
                  <span>{s.name}</span>
                  <select
                    value={s.weight}
                    onChange={(e) => updateSkillWeight(idx, parseFloat(e.target.value))}
                    className="text-[11px] font-bold text-brand-700 bg-white px-1 py-0.5 rounded border border-sky-200 cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-500"
                    title="Change skill weight"
                  >
                    <option value={1.0}>100%</option>
                    <option value={0.9}>90%</option>
                    <option value={0.8}>80%</option>
                    <option value={0.7}>70%</option>
                    <option value={0.6}>60%</option>
                    <option value={0.5}>50%</option>
                    <option value={0.4}>40%</option>
                    <option value={0.3}>30%</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeSkill(idx)}
                    className="text-slate-400 hover:text-rose-600 transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={newSkillName}
                onChange={(e) => setNewSkillName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addSkill();
                  }
                }}
                className="input text-xs flex-1"
                placeholder="Add skill (e.g. System Design, Microservices, React)..."
              />
              <select
                value={newSkillWeight}
                onChange={(e) => setNewSkillWeight(parseFloat(e.target.value))}
                className="input text-xs w-24 py-2 font-semibold cursor-pointer"
                title="Select weight for added skill"
              >
                <option value={1.0}>100%</option>
                <option value={0.9}>90%</option>
                <option value={0.8}>80%</option>
                <option value={0.7}>70%</option>
                <option value={0.6}>60%</option>
                <option value={0.5}>50%</option>
                <option value={0.4}>40%</option>
                <option value={0.3}>30%</option>
              </select>
              <button
                type="button"
                onClick={addSkill}
                className="btn-secondary text-xs px-3 shrink-0 py-2"
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </button>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-sky-100 flex items-center justify-between">
            <div className="text-[11px] text-slate-400 flex items-center gap-1">
              <Shield className="h-3.5 w-3.5 text-emerald-600" />
              Hard constraint checking applied on submit
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="btn-ghost text-xs px-4">
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary text-xs px-5 shadow-md shadow-brand-500/25"
              >
                {submitting ? 'Creating Request...' : 'Create Interview Request'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
