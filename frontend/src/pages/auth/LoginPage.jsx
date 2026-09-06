import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, DEMO_PERSONAS } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import {
  Compass,
  Briefcase,
  UserCheck,
  Users,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Mail,
  Lock,
  User,
  Building,
  KeyRound,
  Sparkles,
  Info,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

const ROLES = [
  {
    id: 'RECRUITER',
    title: 'Recruiter',
    tagline: 'Talent Acquisition & Ops',
    description: 'Post interview requests, automate candidate scheduling & monitor the Control Tower.',
    icon: Briefcase,
    color: 'from-blue-600 to-sky-500',
    accentBg: 'bg-blue-50 text-blue-700 border-blue-200',
    ringColor: 'ring-blue-500',
    demoKey: 'RECRUITER',
  },
  {
    id: 'CANDIDATE',
    title: 'Candidate',
    tagline: 'Job Applicant',
    description: 'Submit your preferred availability, select optimized interview slots & join live rooms.',
    icon: UserCheck,
    color: 'from-emerald-600 to-teal-500',
    accentBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    ringColor: 'ring-emerald-500',
    demoKey: 'CANDIDATE',
  },
  {
    id: 'INTERVIEWER',
    title: 'Interviewer',
    tagline: 'Engineering & Panel',
    description: 'Review assigned interview rounds, accept invites & provide structured evaluations.',
    icon: Users,
    color: 'from-purple-600 to-indigo-500',
    accentBg: 'bg-purple-50 text-purple-700 border-purple-200',
    ringColor: 'ring-purple-500',
    demoKey: 'INTERVIEWER',
  },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, register, switchPersona } = useAuth();

  // Step 1: Role Selection, Step 2: Authentication
  const [selectedRole, setSelectedRole] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyOrTitle, setCompanyOrTitle] = useState('');

  // UI status
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [googleStatus, setGoogleStatus] = useState({ configured: false, checked: false });
  const [showConfigHelp, setShowConfigHelp] = useState(false);

  // Check URL errors (e.g. redirected back from Google callback error)
  useEffect(() => {
    const err = searchParams.get('error');
    if (err) {
      setErrorMsg(decodeURIComponent(err));
    }
  }, [searchParams]);

  // Check server Google OAuth readiness
  useEffect(() => {
    api
      .get('/auth/status')
      .then((data) => {
        setGoogleStatus({ configured: Boolean(data?.googleConfigured), checked: true });
      })
      .catch(() => {
        setGoogleStatus({ configured: false, checked: true });
      });
  }, []);

  function handleRoleSelect(roleId) {
    setSelectedRole(roleId);
    setErrorMsg('');
  }

  function handleBackToRoles() {
    setSelectedRole(null);
    setErrorMsg('');
  }

  async function handleEmailAuth(e) {
    e.preventDefault();
    setErrorMsg('');

    // Validation
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    if (!password || password.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.');
      return;
    }

    if (authMode === 'register') {
      if (!name.trim()) {
        setErrorMsg('Please provide your full name.');
        return;
      }
      if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        setErrorMsg('Password must contain at least one letter and one number.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (authMode === 'login') {
        const u = await login(cleanEmail, password);
        redirectToDashboard(u.role);
      } else {
        const registerPayload = {
          name: name.trim(),
          email: cleanEmail,
          password,
          role: selectedRole,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        };
        if (selectedRole === 'CANDIDATE') {
          registerPayload.currentCompany = companyOrTitle.trim() || undefined;
        } else {
          registerPayload.title = companyOrTitle.trim() || undefined;
        }
        const u = await register(registerPayload);
        redirectToDashboard(u.role);
      }
    } catch (err) {
      console.error('Auth error:', err);
      setErrorMsg(err.response?.data?.message || err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleGoogleLogin() {
    const roleParam = selectedRole || 'CANDIDATE';
    // Direct browser redirect to backend Google OAuth initiation
    window.location.href = `http://localhost:4000/api/auth/google?role=${roleParam}`;
  }

  async function handleDemoShortcut(roleKey) {
    setErrorMsg('');
    setSubmitting(true);
    try {
      const u = await switchPersona(roleKey);
      if (u) redirectToDashboard(u.role);
    } catch (err) {
      setErrorMsg('Demo sign-in failed. Please verify the backend is running.');
    } finally {
      setSubmitting(false);
    }
  }

  function redirectToDashboard(role) {
    if (role === 'CANDIDATE') navigate('/candidate');
    else if (role === 'INTERVIEWER') navigate('/interviewer');
    else navigate('/');
  }

  const activeRoleConfig = ROLES.find((r) => r.id === selectedRole);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#ebf3fa] via-[#e4eef8] to-[#d8e6f5] flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      {/* Background ambient accents */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-300/20 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -right-32 w-96 h-96 bg-sky-300/25 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-2xl w-full mx-auto">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-brand-600 to-sky-500 text-white shadow-lg shadow-brand-500/25 mb-3">
            <Compass className="h-8 w-8 animate-pulse" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Smart Interview Scheduler
          </h1>
          <p className="mt-1 text-sm text-slate-600 font-medium">
            Constraint-Based Multi-Persona Scheduling & Control Tower
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white/95 backdrop-blur-xl border border-sky-100 rounded-3xl shadow-xl shadow-slate-200/50 p-6 sm:p-10 transition-all">
          {/* Error Banner */}
          {errorMsg && (
            <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3 animate-fade-in">
              <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs font-semibold text-rose-800 leading-relaxed">
                {errorMsg}
              </div>
            </div>
          )}

          {/* STEP 1: ROLE PICKER */}
          {!selectedRole ? (
            <div>
              <div className="text-center mb-6">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-brand-600 bg-sky-100/80 px-2.5 py-1 rounded-full border border-sky-200">
                  Step 1 of 2
                </span>
                <h2 className="text-xl font-bold text-slate-900 mt-2">
                  Select Your Workspace Role
                </h2>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  First choose how you will use the platform, then sign in with your email or Google account.
                </p>
              </div>

              {/* 3 Role Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {ROLES.map((role) => {
                  const Icon = role.icon;
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => handleRoleSelect(role.id)}
                      className="group relative text-left p-5 rounded-2xl border-2 border-slate-100 hover:border-brand-500 bg-white hover:bg-sky-50/40 transition-all duration-200 hover:shadow-md flex flex-col justify-between"
                    >
                      <div>
                        <div className={`h-11 w-11 rounded-xl bg-gradient-to-tr ${role.color} text-white flex items-center justify-center shadow-md mb-3 group-hover:scale-105 transition-transform`}>
                          <Icon className="h-6 w-6" />
                        </div>
                        <h3 className="text-base font-bold text-slate-900 group-hover:text-brand-700 transition-colors">
                          {role.title}
                        </h3>
                        <span className="text-[11px] font-semibold text-slate-400 block mb-2">
                          {role.tagline}
                        </span>
                        <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed">
                          {role.description}
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-brand-600 group-hover:translate-x-0.5 transition-transform">
                        <span>Continue</span>
                        <ArrowRight className="h-4 w-4" />
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Quick 1-Click Evaluation Pills */}
              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    Instant Evaluator Sign-In
                  </span>
                  <span className="text-[10px] text-slate-400">1-click demo access</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {ROLES.map((role) => {
                    const p = DEMO_PERSONAS[role.demoKey];
                    return (
                      <button
                        key={role.demoKey}
                        onClick={() => handleDemoShortcut(role.demoKey)}
                        disabled={submitting}
                        className="text-left px-3 py-2 rounded-xl bg-slate-50 hover:bg-sky-50 border border-slate-200 hover:border-brand-300 text-slate-700 transition flex items-center justify-between text-xs font-semibold"
                      >
                        <span className="truncate">{p.name}</span>
                        <span className={`text-[9px] px-1.5 py-0.2 rounded border font-bold ${p.badgeClass}`}>
                          {role.title}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* STEP 2: LOGIN / SIGNUP WITH SELECTED ROLE */
            <div>
              {/* Header with Selected Role badge + Change Role button */}
              <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-100">
                <button
                  onClick={handleBackToRoles}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-brand-600 transition"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Change Role
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-medium">Role:</span>
                  <span className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full border ${activeRoleConfig.accentBg}`}>
                    {activeRoleConfig.title}
                  </span>
                </div>
              </div>

              {/* Toggle: Sign In vs Create Account */}
              <div className="flex rounded-xl bg-slate-100 p-1 mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setErrorMsg('');
                  }}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${
                    authMode === 'login'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('register');
                    setErrorMsg('');
                  }}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${
                    authMode === 'register'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Create {activeRoleConfig.title} Account
                </button>
              </div>

              {/* METHOD 1: GOOGLE OAUTH 2.0 */}
              <div className="mb-5">
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold text-sm shadow-xs hover:shadow transition"
                >
                  {/* Official Google G SVG */}
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </button>

                {/* Google Configuration Status Note */}
                <div className="mt-2 text-center">
                  {!googleStatus.configured && googleStatus.checked && (
                    <div className="text-[11px] text-amber-700 bg-amber-50/80 border border-amber-200 rounded-lg p-2 mt-2">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 font-semibold">
                          <Info className="h-3.5 w-3.5 text-amber-600" />
                          Google OAuth setup instructions
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowConfigHelp(!showConfigHelp)}
                          className="text-amber-800 underline font-bold text-[10px] flex items-center gap-0.5"
                        >
                          {showConfigHelp ? 'Hide' : 'How to configure'}
                          {showConfigHelp ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                      </div>
                      {showConfigHelp && (
                        <div className="text-left mt-2 pt-2 border-t border-amber-200 text-slate-600 text-[11px] space-y-1">
                          <p>To enable real Google sign-in:</p>
                          <ol className="list-decimal list-inside pl-1 space-y-0.5 font-mono text-[10px]">
                            <li>Create credentials in Google Cloud Console (OAuth 2.0 Client ID)</li>
                            <li>Set Authorized redirect URI to: <code className="bg-amber-100 px-1 py-0.5 rounded text-slate-900">http://localhost:4000/api/auth/google/callback</code></li>
                            <li>Add <code className="bg-amber-100 px-1 py-0.5 rounded text-slate-900">GOOGLE_CLIENT_ID</code> and <code className="bg-amber-100 px-1 py-0.5 rounded text-slate-900">GOOGLE_CLIENT_SECRET</code> to your <code className="bg-amber-100 px-1 py-0.5 rounded text-slate-900">.env</code></li>
                          </ol>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* DIVIDER */}
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-3 font-bold text-slate-400">
                    Or continue with email
                  </span>
                </div>
              </div>

              {/* METHOD 2: EMAIL + PASSWORD FORM */}
              <form onSubmit={handleEmailAuth} className="space-y-4">
                {authMode === 'register' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Full Name *
                    </label>
                    <div className="relative">
                      <User className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Priya Sharma"
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 text-xs font-medium text-slate-900 placeholder:text-slate-400"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Work or Personal Email *
                  </label>
                  <div className="relative">
                    <Mail className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@domain.com"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 text-xs font-medium text-slate-900 placeholder:text-slate-400"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      Password *
                    </label>
                    {authMode === 'register' && (
                      <span className="text-[10px] text-slate-400">Min. 8 chars (letters + numbers)</span>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 text-xs font-medium text-slate-900 placeholder:text-slate-400"
                    />
                  </div>
                </div>

                {authMode === 'register' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {selectedRole === 'CANDIDATE' ? 'Current Company (Optional)' : 'Job Title / Department (Optional)'}
                    </label>
                    <div className="relative">
                      <Building className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
                      <input
                        type="text"
                        value={companyOrTitle}
                        onChange={(e) => setCompanyOrTitle(e.target.value)}
                        placeholder={selectedRole === 'CANDIDATE' ? 'e.g. Acme Corp' : 'e.g. Senior Staff Engineer'}
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 text-xs font-medium text-slate-900 placeholder:text-slate-400"
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-sky-600 hover:from-brand-700 hover:to-sky-700 text-white font-bold text-xs tracking-wide shadow-md shadow-brand-600/20 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  ) : (
                    <>
                      <span>{authMode === 'login' ? `Sign In as ${activeRoleConfig.title}` : `Create ${activeRoleConfig.title} Account`}</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>

              {/* 1-Click Demo Shortcut for this specific role */}
              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-slate-400">Quick evaluator test:</span>
                <button
                  type="button"
                  onClick={() => handleDemoShortcut(activeRoleConfig.demoKey)}
                  className="font-bold text-brand-600 hover:text-brand-800 underline"
                >
                  Sign in with demo {activeRoleConfig.title} ({DEMO_PERSONAS[activeRoleConfig.demoKey].name})
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Security & System Note */}
        <div className="mt-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <span>Bcrypt salted password encryption • OpenID Connect 2.0 • ISO-compliant audit logging</span>
        </div>
      </div>
    </div>
  );
}
