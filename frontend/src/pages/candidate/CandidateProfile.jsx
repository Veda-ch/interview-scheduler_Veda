import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import TimezoneCard from '../../components/TimezoneCard.jsx';
import {
  User,
  Award,
  Sparkles,
  Save,
  Plus,
  Trash2,
  Briefcase,
  MapPin,
  Phone,
  FileText,
  Upload,
  CheckCircle2,
  AlertCircle,
  Clock,
  Building,
  Star,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';

const CATEGORY_COLORS = {
  TECHNICAL: 'bg-blue-50 text-blue-700 border-blue-200',
  TOOL: 'bg-purple-50 text-purple-700 border-purple-200',
  SOFT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const SUGGESTED_SKILLS = [
  'Java', 'Spring Boot', 'Python', 'React', 'Node.js', 'TypeScript',
  'SQL', 'PostgreSQL', 'Microservices', 'Docker', 'Kubernetes', 'AWS',
  'System Design', 'Git', 'Kafka', 'Redis', 'GraphQL', 'REST APIs',
];

export default function CandidateProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingSkills, setSavingSkills] = useState(false);
  const [uploadingResume, setUploadingResume] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Profile Details Form State
  const [name, setName] = useState('');
  const [headline, setHeadline] = useState('');
  const [currentCompany, setCurrentCompany] = useState('');
  const [location, setLocation] = useState('');
  const [phone, setPhone] = useState('');
  const [yearsExperience, setYearsExperience] = useState(0);

  // Skills State
  const [skills, setSkills] = useState([]);
  const [newSkillName, setNewSkillName] = useState('');
  const [newProficiency, setNewProficiency] = useState(4);
  const [catalog, setCatalog] = useState([]);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    setLoading(true);
    setError(null);
    try {
      const [candidateData, skillsCatalog] = await Promise.all([
        api.get('/candidates/me'),
        api.get('/users/skills').catch(() => []),
      ]);

      setProfile(candidateData);
      setCatalog(skillsCatalog || []);

      // Populate form fields
      setName(candidateData.name || user?.name || '');
      setHeadline(candidateData.headline || '');
      setCurrentCompany(candidateData.currentCompany || '');
      setLocation(candidateData.location || '');
      setPhone(candidateData.phone || '');
      setYearsExperience(candidateData.yearsExperience || 0);

      // Populate skills
      setSkills(candidateData.skills || []);
    } catch (err) {
      console.error('Failed to load candidate profile:', err);
      setError(err.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }

  function flash(msg) {
    setSuccess(msg);
    setError(null);
    setTimeout(() => setSuccess(null), 4000);
  }

  async function handleSaveDetails(e) {
    if (e) e.preventDefault();
    setSavingDetails(true);
    setError(null);

    try {
      const payload = {
        name,
        headline,
        currentCompany,
        location,
        phone: phone || null,
        yearsExperience: Number(yearsExperience) || 0,
      };

      const updated = await api.put('/candidates/me', payload);
      setProfile(updated);
      flash('Profile details updated successfully!');
    } catch (err) {
      setError(err.message || 'Failed to update profile');
    } finally {
      setSavingDetails(false);
    }
  }

  function handleAddSkill(e) {
    if (e) e.preventDefault();
    const trimmed = newSkillName.trim();
    if (!trimmed) return;

    // Check duplicate
    if (skills.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(`Skill "${trimmed}" is already in your skills list.`);
      return;
    }

    const matchingInCatalog = catalog.find(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase()
    );

    const newSkillObj = {
      name: matchingInCatalog ? matchingInCatalog.name : trimmed,
      category: matchingInCatalog?.category || 'TECHNICAL',
      proficiency: Number(newProficiency) || 3,
      source: 'SELF',
    };

    const updatedSkills = [...skills, newSkillObj];
    setSkills(updatedSkills);
    setNewSkillName('');
    setNewProficiency(4);
    saveSkillsToBackend(updatedSkills);
  }

  function handleQuickAddSkill(skillName) {
    if (skills.some((s) => s.name.toLowerCase() === skillName.toLowerCase())) return;
    const matchingInCatalog = catalog.find(
      (c) => c.name.toLowerCase() === skillName.toLowerCase()
    );
    const newSkillObj = {
      name: matchingInCatalog ? matchingInCatalog.name : skillName,
      category: matchingInCatalog?.category || 'TECHNICAL',
      proficiency: 4,
      source: 'SELF',
    };
    const updatedSkills = [...skills, newSkillObj];
    setSkills(updatedSkills);
    saveSkillsToBackend(updatedSkills);
  }

  function handleRemoveSkill(skillIndex) {
    const updatedSkills = skills.filter((_, idx) => idx !== skillIndex);
    setSkills(updatedSkills);
    saveSkillsToBackend(updatedSkills);
  }

  function handleProficiencyChange(skillIndex, newProf) {
    const updatedSkills = skills.map((s, idx) =>
      idx === skillIndex ? { ...s, proficiency: Number(newProf) } : s
    );
    setSkills(updatedSkills);
    saveSkillsToBackend(updatedSkills);
  }

  async function saveSkillsToBackend(skillList) {
    setSavingSkills(true);
    setError(null);
    try {
      const payload = {
        skills: skillList.map((s) => ({
          name: s.name,
          proficiency: s.proficiency,
        })),
      };
      const updated = await api.put('/candidates/me', payload);
      setProfile(updated);
      setSkills(updated.skills || []);
      flash('Skills list updated successfully!');
    } catch (err) {
      setError(err.message || 'Failed to update skills');
    } finally {
      setSavingSkills(false);
    }
  }

  async function handleResumeUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingResume(true);
    setError(null);

    try {
      const res = await api.upload('/candidates/me/resume', file);
      if (res.candidate) {
        setProfile(res.candidate);
      }
      flash(`Resume uploaded successfully! (${res.extractedTextLength || 0} characters extracted)`);
    } catch (err) {
      setError(err.message || 'Failed to upload resume file');
    } finally {
      setUploadingResume(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <div className="h-10 w-10 rounded-full border-4 border-brand-600 border-t-transparent animate-spin mx-auto mb-3" />
        <p className="text-xs font-bold text-slate-600">Loading your profile...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Top Hero Banner */}
      <div className="card p-6 bg-gradient-to-r from-emerald-50 via-white to-sky-50/70 border border-sky-100 shadow-sm mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-extrabold text-2xl shadow-md shadow-emerald-500/20">
              {profile?.name?.charAt(0) || user?.name?.charAt(0) || 'C'}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100/80 px-2.5 py-0.5 rounded-full border border-emerald-200">
                  {profile?.candidateNumber || 'Candidate'}
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  {profile?.email || user?.email}
                </span>
              </div>
              <h1 className="text-2xl font-extrabold text-slate-900 mt-1">
                {profile?.name || user?.name || 'My Profile'}
              </h1>
              <p className="text-xs text-slate-600 font-medium mt-0.5">
                {profile?.headline || 'Add your professional headline below to stand out'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="px-3.5 py-2 rounded-xl bg-white border border-sky-100 shadow-xs text-center">
              <span className="text-base font-extrabold text-brand-600 block leading-tight">
                {skills.length}
              </span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Skills Listed
              </span>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-white border border-sky-100 shadow-xs text-center">
              <span className="text-base font-extrabold text-emerald-600 block leading-tight">
                {profile?.yearsExperience || yearsExperience || 0}
              </span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Yrs Experience
              </span>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-white border border-sky-100 shadow-xs text-center">
              <span className="text-base font-extrabold text-purple-600 block leading-tight">
                {profile?.applications?.length || 0}
              </span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Active Roles
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Status Alerts */}
      {success && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2 animate-fade-in shadow-xs">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center gap-2 animate-fade-in shadow-xs">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Personal Info, Resume & Timezone (6 Cols) */}
        <div className="lg:col-span-6 space-y-6">
          {/* Personal & Career Details Card */}
          <div className="card p-6 bg-white border border-sky-100 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-sky-50 mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-brand-100 text-brand-700">
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Personal & Career Details</h2>
                  <p className="text-[11px] text-slate-500">
                    Shown to interviewers and recruiters evaluating your fit
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveDetails} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="label text-[11px]">Full Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Aisha Khan"
                    className="input text-xs"
                    required
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="label text-[11px]">Contact Phone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +91 98765 43210"
                    className="input text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="label text-[11px]">Professional Headline</label>
                <input
                  type="text"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="e.g. Senior Backend Engineer | Java, Spring Boot & Distributed Systems"
                  className="input text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-[11px]">Current Company</label>
                  <input
                    type="text"
                    value={currentCompany}
                    onChange={(e) => setCurrentCompany(e.target.value)}
                    placeholder="e.g. Acme Tech Solutions"
                    className="input text-xs"
                  />
                </div>
                <div>
                  <label className="label text-[11px]">Current Location</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Bengaluru, India"
                    className="input text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="label text-[11px]">Total Experience (Years)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="50"
                  value={yearsExperience}
                  onChange={(e) => setYearsExperience(e.target.value)}
                  className="input text-xs w-36"
                />
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={savingDetails}
                  className="btn-primary text-xs py-2 px-5 flex items-center gap-2 shadow-sm"
                >
                  <Save className="h-4 w-4" />
                  {savingDetails ? 'Saving Profile...' : 'Save Profile Details'}
                </button>
              </div>
            </form>
          </div>

          {/* Resume Upload Card */}
          <div className="card p-6 bg-white border border-sky-100 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-sky-50 mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700">
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Resume & CV Parsing</h2>
                  <p className="text-[11px] text-slate-500">
                    Used by the skill matcher to compute match scores for job rounds
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {profile?.resumeUrl ? (
                <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-6 w-6 text-emerald-600 shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-slate-900 block">
                        Resume Uploaded
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {profile.hasResumeText
                          ? 'Text extracted and indexed for skill coverage matching.'
                          : 'File attached.'}
                      </span>
                    </div>
                  </div>
                  <a
                    href={profile.resumeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary text-[11px] py-1.5 px-3 flex items-center gap-1 shrink-0"
                  >
                    View <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-sky-50/50 border border-sky-100 text-xs text-slate-600">
                  No resume uploaded yet. Upload a PDF or TXT to enable semantic skill matching.
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Upload New Resume (PDF or TXT)
                </label>
                <div className="flex items-center gap-3">
                  <label className="btn-secondary text-xs py-2 px-4 cursor-pointer flex items-center gap-2 border-dashed border-sky-300 bg-sky-50/40 hover:bg-sky-100/60">
                    <Upload className="h-4 w-4 text-brand-600" />
                    <span>{uploadingResume ? 'Extracting text...' : 'Select Resume File'}</span>
                    <input
                      type="file"
                      accept=".pdf,.txt,.doc,.docx"
                      onChange={handleResumeUpload}
                      disabled={uploadingResume}
                      className="hidden"
                    />
                  </label>
                  {uploadingResume && (
                    <span className="text-xs text-brand-600 animate-pulse font-medium">
                      Uploading and parsing...
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Timezone Card */}
          <TimezoneCard note="Your availability schedule and interview invitations are aligned to this timezone." />
        </div>

        {/* Right Column: Skills Management (Primary) & Active Roles (6 Cols) */}
        <div className="lg:col-span-6 space-y-6">
          {/* Skills Management Card */}
          <div className="card p-6 bg-white border border-sky-100 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-sky-50 mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-purple-100 text-purple-700">
                  <Award className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Skills & Technical Competencies ({skills.length})
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Matched with open job opportunities and interview requirements
                  </p>
                </div>
              </div>

              {savingSkills && (
                <span className="text-xs text-purple-600 font-semibold animate-pulse flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5 animate-spin" /> Saving...
                </span>
              )}
            </div>

            {/* Add Skill Form */}
            <form onSubmit={handleAddSkill} className="p-4 rounded-xl bg-sky-50/60 border border-sky-100 mb-5 space-y-3">
              <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Plus className="h-4 w-4 text-brand-600" /> Add New Skill
              </span>

              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-12 sm:col-span-7">
                  <label className="label text-[10px]">Skill Name</label>
                  <input
                    type="text"
                    value={newSkillName}
                    onChange={(e) => setNewSkillName(e.target.value)}
                    list="candidate-skill-catalog"
                    placeholder="e.g. Java, React, System Design"
                    className="input text-xs"
                    required
                  />
                  <datalist id="candidate-skill-catalog">
                    {catalog.map((s) => (
                      <option key={s.id || s.name} value={s.name} />
                    ))}
                  </datalist>
                </div>

                <div className="col-span-12 sm:col-span-5">
                  <label className="label text-[10px]">Proficiency Level</label>
                  <select
                    value={newProficiency}
                    onChange={(e) => setNewProficiency(e.target.value)}
                    className="input text-xs cursor-pointer"
                  >
                    <option value="5">5 — Expert / Lead</option>
                    <option value="4">4 — Advanced</option>
                    <option value="3">3 — Intermediate</option>
                    <option value="2">2 — Working Knowledge</option>
                    <option value="1">1 — Beginner</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5 shadow-xs"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Skill
                </button>
              </div>
            </form>

            {/* Quick-add suggestions */}
            <div className="mb-5">
              <span className="text-[11px] font-bold text-slate-600 block mb-2">
                Quick-Add Popular Skills:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_SKILLS.filter(
                  (name) => !skills.some((s) => s.name.toLowerCase() === name.toLowerCase())
                ).slice(0, 10).map((skillName) => (
                  <button
                    key={skillName}
                    type="button"
                    onClick={() => handleQuickAddSkill(skillName)}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200 border border-slate-200 transition flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" /> {skillName}
                  </button>
                ))}
              </div>
            </div>

            {/* Current Skills List */}
            <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
              {skills.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400 bg-sky-50/30 rounded-xl border border-dashed border-sky-100">
                  <Award className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                  No skills listed yet. Add your core technical and soft skills above!
                </div>
              ) : (
                skills.map((skill, index) => {
                  const categoryBadge =
                    CATEGORY_COLORS[skill.category] || 'bg-slate-100 text-slate-700 border-slate-200';

                  return (
                    <div
                      key={index}
                      className="p-3 rounded-xl border border-sky-100 bg-sky-50/30 hover:bg-sky-50/60 transition flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="font-bold text-slate-900 truncate">
                          {skill.name}
                        </span>
                        <span
                          className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border uppercase tracking-wider ${categoryBadge}`}
                        >
                          {skill.category || 'TECHNICAL'}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {/* Star / Proficiency Visual Rating */}
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((starVal) => (
                            <button
                              key={starVal}
                              type="button"
                              onClick={() => handleProficiencyChange(index, starVal)}
                              className="focus:outline-none transition p-0.5"
                              title={`Set proficiency to ${starVal}/5`}
                            >
                              <Star
                                className={`h-3.5 w-3.5 ${
                                  starVal <= (skill.proficiency || 3)
                                    ? 'text-amber-500 fill-amber-400'
                                    : 'text-slate-200 hover:text-slate-300'
                                }`}
                              />
                            </button>
                          ))}
                          <span className="text-[10px] text-slate-500 font-semibold ml-1">
                            {skill.proficiency || 3}/5
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveSkill(index)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition hover:bg-rose-50"
                          title="Remove skill"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Active Job Applications Card */}
          {profile?.applications?.length > 0 && (
            <div className="card p-6 bg-white border border-sky-100 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-sky-50 mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700">
                    <Briefcase className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      Applied Roles & Stages ({profile.applications.length})
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Roles where your profile is actively being considered
                    </p>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {profile.applications.map((app) => (
                  <div key={app.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <span className="font-bold text-slate-900 block">
                        {app.jobTitle}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {app.department} • Stage: <strong className="text-brand-700">{app.stage}</strong>
                      </span>
                    </div>
                    <span className="chip chip-blue text-[10px] font-bold">
                      {app.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
