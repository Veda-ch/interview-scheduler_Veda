import React, { useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Header from './components/Header.jsx';
import RequestModal from './pages/recruiter/RequestModal.jsx';
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
import ChooseSlot from './pages/candidate/ChooseSlot.jsx';
import CandidateProfile from './pages/candidate/CandidateProfile.jsx';

import InterviewerAssignments from './pages/interviewer/InterviewerAssignments.jsx';
import InterviewerProfile from './pages/interviewer/InterviewerProfile.jsx';
import VirtualRoom from './pages/meeting/VirtualRoom.jsx';
import { useAuth } from './context/AuthContext.jsx';

export default function App() {
  const { loading, user } = useAuth();
  const location = useLocation();
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="h-8 w-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-xs font-semibold text-gray-600">Loading TalentFlow...</p>
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

  // Full-screen unauthenticated or dedicated routes (meeting room, login)
  if (!user || isAuthPage || isMeetingRoom) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 selection:bg-indigo-600 selection:text-white">
        <Routes>
          <Route
            path="/login"
            element={user ? <Navigate to={getRoleHome(user.role)} replace /> : <LoginPage />}
          />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/meeting/:id" element={<VirtualRoom />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </div>
    );
  }

  // Authenticated Enterprise SaaS Layout Shell: Fixed Sidebar + Top Header + Responsive Workspace
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 text-gray-900 selection:bg-indigo-600 selection:text-white">
      {/* Left Navigation Sidebar */}
      <Sidebar onOpenScheduleModal={() => setScheduleModalOpen(true)} />

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col h-screen min-w-0 overflow-hidden">
        {/* Top Header */}
        <Header onOpenScheduleModal={() => setScheduleModalOpen(true)} />

        {/* Dynamic Page Content */}
        <main className="flex-1 overflow-y-auto bg-gray-50">
          <Routes>
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
            {/* Master Scheduler & Calendar (Exact 3-Column Layout from design) */}
            <Route path="/calendar" element={<CalendarView onOpenScheduleModal={() => setScheduleModalOpen(true)} />} />
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
              path="/candidate/choose-slot"
              element={
                user.role === 'CANDIDATE' ? <ChooseSlot /> : <Navigate to={getRoleHome(user.role)} replace />
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

            {/* Default catch-all for logged-in users */}
            <Route path="*" element={<Navigate to={getRoleHome(user.role)} replace />} />
          </Routes>
        </main>
      </div>

      {/* Global Schedule Interview Modal */}
      <RequestModal
        isOpen={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        onSuccess={() => setScheduleModalOpen(false)}
      />
    </div>
  );
}
