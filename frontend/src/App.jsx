import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import LoginPage from './pages/auth/LoginPage.jsx';
import AuthCallback from './pages/auth/AuthCallback.jsx';

import PipelineDashboard from './pages/recruiter/PipelineDashboard.jsx';
import ScheduleBuilder from './pages/recruiter/ScheduleBuilder.jsx';
import CalendarView from './pages/recruiter/CalendarView.jsx';
import ControlTower from './pages/recruiter/ControlTower.jsx';
import AnalyticsView from './pages/recruiter/AnalyticsView.jsx';
import JobsPage from './pages/recruiter/JobsPage.jsx';
import EvaluationsView from './pages/recruiter/EvaluationsView.jsx';

import CandidatePortal from './pages/candidate/CandidatePortal.jsx';
import AvailabilityPicker from './pages/candidate/AvailabilityPicker.jsx';
import SlotConfirmation from './pages/candidate/SlotConfirmation.jsx';
import CandidateProfile from './pages/candidate/CandidateProfile.jsx';

import InterviewerAssignments from './pages/interviewer/InterviewerAssignments.jsx';
import InterviewerProfile from './pages/interviewer/InterviewerProfile.jsx';
import VirtualRoom from './pages/meeting/VirtualRoom.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { ShieldCheck, Cpu } from 'lucide-react';

export default function App() {
  const { loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#ebf3fa]">
        <div className="text-center">
          <div className="h-10 w-10 rounded-full border-4 border-brand-600 border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-xs font-bold text-slate-700">Loading Smart Interview Scheduler...</p>
        </div>
      </div>
    );
  }

  const isMeetingRoom = location.pathname.startsWith('/meeting/');
  const isAuthPage = location.pathname === '/login' || location.pathname === '/auth/callback';

  // Role home redirect helper
  function getRoleHome(role) {
    if (role === 'CANDIDATE') return '/candidate';
    if (role === 'INTERVIEWER') return '/interviewer';
    return '/';
  }

  return (
    <div className="min-h-screen flex flex-col selection:bg-brand-500 selection:text-white bg-[#ebf3fa]">
      {/* Hide Navbar on full-screen meeting room or dedicated Auth pages */}
      {!isMeetingRoom && !isAuthPage && <Navbar />}

      <main className="flex-1">
        <Routes>
          {/* Public Auth Routes */}
          <Route
            path="/login"
            element={user ? <Navigate to={getRoleHome(user.role)} replace /> : <LoginPage />}
          />
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* Protected Routes (require authenticated user) */}
          {user ? (
            <>
              {/* Recruiter Routes */}
              <Route
                path="/"
                element={
                  user.role === 'RECRUITER' ? (
                    <PipelineDashboard />
                  ) : (
                    <Navigate to={getRoleHome(user.role)} replace />
                  )
                }
              />
              <Route
                path="/builder"
                element={
                  user.role === 'RECRUITER' ? (
                    <ScheduleBuilder />
                  ) : (
                    <Navigate to={getRoleHome(user.role)} replace />
                  )
                }
              />
              {/* Read-only calendar. Both endpoints it reads are scoped to the
                  caller server-side, so every role sees only their own events. */}
              <Route path="/calendar" element={<CalendarView />} />
              <Route
                path="/control-tower"
                element={
                  user.role === 'RECRUITER' ? (
                    <ControlTower />
                  ) : (
                    <Navigate to={getRoleHome(user.role)} replace />
                  )
                }
              />
              <Route
                path="/analytics"
                element={
                  user.role === 'RECRUITER' ? (
                    <AnalyticsView />
                  ) : (
                    <Navigate to={getRoleHome(user.role)} replace />
                  )
                }
              />
              <Route
                path="/evaluations"
                element={
                  user.role === 'RECRUITER' || user.role === 'ADMIN' ? (
                    <EvaluationsView />
                  ) : (
                    <Navigate to={getRoleHome(user.role)} replace />
                  )
                }
              />
              <Route
                path="/jobs"
                element={
                  user.role === 'RECRUITER' || user.role === 'ADMIN' ? (
                    <JobsPage />
                  ) : (
                    <Navigate to={getRoleHome(user.role)} replace />
                  )
                }
              />

              {/* Candidate Routes */}
              <Route
                path="/candidate"
                element={
                  user.role === 'CANDIDATE' || user.role === 'RECRUITER' ? (
                    <CandidatePortal />
                  ) : (
                    <Navigate to={getRoleHome(user.role)} replace />
                  )
                }
              />
              <Route
                path="/candidate/availability"
                element={
                  user.role === 'CANDIDATE' || user.role === 'RECRUITER' ? (
                    <AvailabilityPicker />
                  ) : (
                    <Navigate to={getRoleHome(user.role)} replace />
                  )
                }
              />
              <Route
                path="/candidate/slots"
                element={
                  user.role === 'CANDIDATE' || user.role === 'RECRUITER' ? (
                    <SlotConfirmation />
                  ) : (
                    <Navigate to={getRoleHome(user.role)} replace />
                  )
                }
              />
              <Route
                path="/candidate/profile"
                element={
                  user.role === 'CANDIDATE' || user.role === 'RECRUITER' ? (
                    <CandidateProfile />
                  ) : (
                    <Navigate to={getRoleHome(user.role)} replace />
                  )
                }
              />

              {/* Interviewer Routes */}
              <Route
                path="/interviewer"
                element={
                  user.role === 'INTERVIEWER' || user.role === 'RECRUITER' ? (
                    <InterviewerAssignments />
                  ) : (
                    <Navigate to={getRoleHome(user.role)} replace />
                  )
                }
              />
              <Route
                path="/interviewer/profile"
                element={
                  user.role === 'INTERVIEWER' ? (
                    <InterviewerProfile />
                  ) : (
                    <Navigate to={getRoleHome(user.role)} replace />
                  )
                }
              />

              {/* Virtual Room Embed */}
              <Route path="/meeting/:id" element={<VirtualRoom />} />

              {/* Default catch-all for logged-in users */}
              <Route path="*" element={<Navigate to={getRoleHome(user.role)} replace />} />
            </>
          ) : (
            /* Unauthenticated fallback: send to /login */
            <Route path="*" element={<Navigate to="/login" replace />} />
          )}
        </Routes>
      </main>

      {/* Footer */}
      {!isMeetingRoom && !isAuthPage && (
        <footer className="mt-auto border-t border-sky-100 bg-white/70 py-4 px-6 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="font-semibold text-slate-700">Smart Interview Orchestration Engine</span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3 text-purple-600" /> OR-Tools CP-SAT Solver Active
            </span>
          </div>
          <div className="flex items-center gap-3 font-medium text-slate-400">
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              Double-Booking Serializable Guard
            </span>
            <span>•</span>
            <span>Light Blue Theme</span>
          </div>
        </footer>
      )}
    </div>
  );
}
