import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import FeedbackModal from './FeedbackModal.jsx';
import {
  Users,
  Calendar,
  Clock,
  Video,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Sparkles,
  AlertTriangle,
  RefreshCw,
  Award,
} from 'lucide-react';
import { DateTime } from 'luxon';

export default function InterviewerAssignments() {
  const { user } = useAuth();
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedInterviewForFeedback, setSelectedInterviewForFeedback] = useState(null);
  const [declineModalId, setDeclineModalId] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [actionSuccess, setActionSuccess] = useState(null);

  useEffect(() => {
    loadAssignments();
  }, []);

  async function loadAssignments() {
    setLoading(true);
    try {
      const data = await api.get('/interviews?take=20');
      setInterviews(data || []);
    } catch (err) {
      console.error('Failed to load assignments:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAccept(interviewId) {
    try {
      await api.post(`/interviews/${interviewId}/accept`);
      setActionSuccess('Assignment accepted! Added to your schedule.');
      loadAssignments();
    } catch (err) {
      alert(err.message || 'Failed to accept assignment');
    }
  }

  async function handleDecline(e) {
    e.preventDefault();
    if (!declineModalId || !declineReason.trim()) return;
    try {
      await api.post(`/interviews/${declineModalId}/decline-assignment`, {
        reason: declineReason,
      });
      setActionSuccess('Assignment declined. The Control Tower has been notified to re-match the panel.');
      setDeclineModalId(null);
      setDeclineReason('');
      loadAssignments();
    } catch (err) {
      alert(err.message || 'Failed to decline assignment');
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Top Banner */}
      <div className="card p-6 bg-gradient-to-r from-purple-50 via-white to-sky-50/50 border border-sky-100 shadow-sm mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center font-extrabold text-lg shadow-sm">
              {user?.name?.charAt(0) || 'A'}
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-purple-800 bg-purple-100/70 px-2 py-0.5 rounded-full border border-purple-200">
                Interviewer Panel Hub
              </span>
              <h1 className="text-2xl font-extrabold text-slate-900 mt-1">
                Panel Assignments: {user?.name || 'Ananya Sharma'}
              </h1>
              <p className="text-xs text-slate-500">
                Seniority: Senior Staff Engineer • Timezone: {user?.timezone || 'Asia/Kolkata (IST)'}
              </p>
            </div>
          </div>

          <button
            onClick={loadAssignments}
            className="btn-ghost text-xs py-2 px-3 text-slate-600 flex items-center gap-1.5 self-start sm:self-auto"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {actionSuccess && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Assignments List */}
      <div className="space-y-4">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Users className="h-5 w-5 text-purple-600" />
          Upcoming Panel Appointments ({interviews.length})
        </h2>

        {interviews.length === 0 && !loading && (
          <div className="card p-12 text-center bg-white border border-sky-100 text-xs text-slate-400">
            No interviews currently assigned to your panel.
          </div>
        )}

        {interviews.map((iv) => {
          const start = DateTime.fromISO(iv.startUtc, { zone: user?.timezone || 'UTC' });
          const end = DateTime.fromISO(iv.endUtc, { zone: user?.timezone || 'UTC' });
          const candidate = iv.request?.application?.candidate?.user?.name || 'Rahul Mehta';
          const job = iv.request?.application?.job?.title || 'Senior Software Engineer';

          return (
            <div
              key={iv.id}
              className="card p-5 bg-white border border-sky-100 shadow-sm hover:border-sky-200 transition"
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                {/* Info Left */}
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-extrabold text-brand-700 bg-sky-50 px-2.5 py-0.5 rounded border border-sky-200">
                      {iv.request?.roundName || 'Technical Round 1'}
                    </span>
                    <span className="chip chip-blue">{iv.request?.interviewType}</span>
                    <span className="chip chip-green">Status: {iv.status}</span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900">
                    Candidate: {candidate} • <span className="text-slate-500 font-normal">{job}</span>
                  </h3>

                  <div className="mt-2 flex items-center gap-4 text-xs text-slate-600 font-medium">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-brand-600" />
                      {start.toFormat('cccc, LLL dd, yyyy')}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-brand-600" />
                      {start.toFormat('hh:mm a')} – {end.toFormat('hh:mm a')} ({user?.timezone || 'IST'})
                    </span>
                  </div>
                </div>

                {/* Actions Right */}
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={`/meeting/${iv.id}`}
                    className="btn-primary text-xs py-2 px-3.5 shadow-xs flex items-center gap-1.5"
                  >
                    <Video className="h-3.5 w-3.5" /> Join Room
                  </a>
                  <button
                    onClick={() => setSelectedInterviewForFeedback(iv)}
                    className="btn-secondary text-xs py-2 px-3.5 flex items-center gap-1.5"
                  >
                    <MessageSquare className="h-3.5 w-3.5 text-purple-600" /> Submit Feedback
                  </button>
                  <button
                    onClick={() => handleAccept(iv.id)}
                    className="btn-ghost text-xs py-2 px-3 text-emerald-700 hover:bg-emerald-50 border-emerald-200 flex items-center gap-1"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Accept
                  </button>
                  <button
                    onClick={() => setDeclineModalId(iv.id)}
                    className="btn-ghost text-xs py-2 px-3 text-rose-700 hover:bg-rose-50 border-rose-200 flex items-center gap-1"
                  >
                    <XCircle className="h-3.5 w-3.5 text-rose-600" /> Decline
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Decline Reason Modal */}
      {declineModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-sky-100 animate-fade-in">
            <h3 className="text-base font-bold text-slate-900 mb-2">Decline Panel Assignment</h3>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Declining this assignment will immediately trigger the <strong>Control Tower</strong> self-healing engine to evaluate available substitute panelists and heal the schedule.
            </p>

            <form onSubmit={handleDecline} className="space-y-4">
              <textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="e.g. Unforeseen production incident oncall duty during this hour."
                rows={3}
                className="input text-xs resize-none"
                required
              />

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeclineModalId(null)}
                  className="btn-ghost text-xs py-2 px-3"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-danger text-xs py-2 px-4 shadow-sm"
                >
                  Decline & Trigger Re-matching
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Feedback Submission Modal */}
      <FeedbackModal
        isOpen={Boolean(selectedInterviewForFeedback)}
        interview={selectedInterviewForFeedback}
        onClose={() => setSelectedInterviewForFeedback(null)}
        onSuccess={() => {
          setActionSuccess('Feedback submitted! AI has processed candidate strengths and gaps.');
        }}
      />
    </div>
  );
}
