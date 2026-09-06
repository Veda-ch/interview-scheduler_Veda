import React, { useState } from 'react';
import { api } from '../../lib/api.js';
import {
  X,
  Star,
  MessageSquare,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Award,
} from 'lucide-react';

const RECOMMENDATIONS = [
  { value: 'STRONG_YES', label: 'Strong Yes (Hire immediately)' },
  { value: 'YES', label: 'Yes (Clear pass)' },
  { value: 'NEUTRAL', label: 'Neutral / Borderline' },
  { value: 'NO', label: 'No (Does not meet bar)' },
  { value: 'STRONG_NO', label: 'Strong No (Significant gaps)' },
];

export default function FeedbackModal({ isOpen, onClose, interview, onSuccess }) {
  const [overallRating, setOverallRating] = useState(4);
  const [recommendation, setRecommendation] = useState('YES');
  const [comments, setComments] = useState(
    'Strong knowledge of Core Java, microservices architecture, and SQL. Handled concurrency questions well, but struggled somewhat with advanced database indexing and query optimization tuning.'
  );
  const [ratings, setRatings] = useState({
    'Core Technical Knowledge': 4,
    'System Architecture': 4,
    'Problem Solving': 4,
    'Database & Optimization': 2,
    Communication: 4,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen || !interview) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post(`/interviews/${interview.id}/feedback`, {
        overallRating: Number(overallRating),
        recommendation,
        ratings,
        comments,
      });
      onSuccess?.(res);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-sky-100 overflow-hidden animate-fade-in my-8">
        {/* Header */}
        <div className="px-6 py-4 border-b border-sky-100 bg-sky-50/70 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-600 text-white shadow-xs">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Submit Interview Feedback</h3>
              <p className="text-xs text-slate-500">
                Evaluation feeds AI next-round focus topic extraction
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

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Rating Stars & Recommendation */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Overall Score (1 - 5)</label>
              <div className="flex items-center gap-2 py-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setOverallRating(star)}
                    className="p-1 transition hover:scale-110"
                  >
                    <Star
                      className={`h-6 w-6 ${
                        star <= overallRating
                          ? 'fill-amber-400 text-amber-500'
                          : 'text-slate-200 fill-slate-100'
                      }`}
                    />
                  </button>
                ))}
                <span className="font-extrabold text-sm text-slate-800 ml-2">
                  {overallRating} / 5
                </span>
              </div>
            </div>

            <div>
              <label className="label">Hiring Recommendation *</label>
              <select
                value={recommendation}
                onChange={(e) => setRecommendation(e.target.value)}
                className="input cursor-pointer text-xs font-semibold"
              >
                {RECOMMENDATIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Category Ratings Sliders */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-3">
            <span className="text-[11px] font-bold uppercase text-slate-500 block">
              Competency Breakdown
            </span>
            {Object.entries(ratings).map(([skill, val]) => (
              <div key={skill} className="flex items-center justify-between gap-4 text-xs">
                <span className="font-medium text-slate-700 w-44 shrink-0 truncate">
                  {skill}
                </span>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={val}
                  onChange={(e) =>
                    setRatings({ ...ratings, [skill]: Number(e.target.value) })
                  }
                  className="w-full accent-brand-600 cursor-pointer"
                />
                <span className="font-extrabold text-slate-800 w-6 text-right">{val}</span>
              </div>
            ))}
          </div>

          {/* Written Feedback Comments */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="label mb-0">Detailed Assessment & Notes *</label>
              <span className="text-[10px] text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-100 flex items-center gap-1">
                <Sparkles className="h-2.5 w-2.5" /> AI feedback analysis active
              </span>
            </div>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={4}
              className="input text-xs leading-relaxed resize-none"
              placeholder="Detail candidate strengths, answers to technical questions, and specific skill gaps..."
              required
            />
          </div>

          {/* Footer */}
          <div className="pt-3 border-t border-sky-100 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-ghost text-xs py-2 px-4">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary text-xs py-2 px-5 shadow-sm"
            >
              {submitting ? 'Submitting & Analyzing...' : 'Submit Evaluation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
