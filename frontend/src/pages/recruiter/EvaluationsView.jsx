import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import {
  Trophy,
  Cpu,
  ThumbsUp,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Star,
  RefreshCw,
  Users,
  Target,
} from 'lucide-react';
import { DateTime } from 'luxon';

const REC_STYLES = {
  STRONG_YES: 'chip chip-green font-bold',
  YES: 'chip chip-green',
  NEUTRAL: 'chip chip-blue',
  NO: 'chip chip-amber',
  STRONG_NO: 'chip chip-red',
};

const SENTIMENT_STYLES = {
  POSITIVE: 'chip chip-green',
  MIXED: 'chip chip-amber',
  NEGATIVE: 'chip chip-red',
};

function scoreColor(score) {
  if (score == null) return 'text-slate-400';
  if (score >= 75) return 'text-emerald-600 font-bold';
  if (score >= 50) return 'text-slate-800 font-bold';
  return 'text-slate-500 font-medium';
}

function Stars({ value }) {
  if (value == null) return <span className="text-slate-400 text-[11px] font-medium">no rating</span>;
  return (
    <span className="inline-flex items-center gap-0.5" title={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-3.5 w-3.5 ${
            n <= Math.round(value) ? 'text-amber-400 fill-amber-400' : 'text-slate-200'
          }`}
        />
      ))}
      <span className="ml-1.5 text-[11px] font-bold text-slate-800">{value}</span>
    </span>
  );
}

export default function EvaluationsView() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get('/analytics/candidate-evaluations'));
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load evaluations');
    } finally {
      setLoading(false);
    }
  }

  const evaluated = rows.filter((r) => r.hasFeedback);
  const pending = rows.filter((r) => !r.hasFeedback);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Top Banner */}
      <div className="card p-6 bg-gradient-to-r from-purple-50 via-white to-sky-50/50 border border-sky-100 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center font-extrabold text-lg shadow-sm">
              <Trophy className="h-6 w-6" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-purple-800 bg-purple-100/70 px-2.5 py-0.5 rounded-full border border-purple-200">
                Performance Scorecards
              </span>
              <h1 className="text-2xl font-extrabold text-slate-900 mt-1">
                Candidate Evaluations & Feedback
              </h1>
            </div>
          </div>
          <button
            onClick={load}
            className="btn-secondary text-xs py-2 px-3.5 flex items-center gap-1.5 font-bold self-start sm:self-auto"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-purple-600 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 shadow-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center">
          <div className="h-8 w-8 rounded-full border-4 border-purple-600 border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-xs font-bold text-slate-700">Loading evaluations...</p>
        </div>
      ) : evaluated.length === 0 ? (
        <div className="card p-12 text-center bg-white border border-sky-100 rounded-2xl shadow-xs">
          <Cpu className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-900">No Candidate Evaluations Submitted Yet</p>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Once interviewers submit their feedback, scorecards and evaluation ratings will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* ------------------------------------------ comparison table --- */}
          <div className="card bg-white border border-sky-100 shadow-sm mb-6 overflow-hidden rounded-2xl">
            <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/50">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Target className="h-4 w-4 text-purple-600" />
                Candidate Comparison ({evaluated.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-600 border-b border-slate-200 bg-slate-50/80 font-bold">
                    <th className="px-5 py-3 font-bold">#</th>
                    <th className="px-3 py-3 font-bold">Candidate</th>
                    <th className="px-3 py-3 font-bold">Role</th>
                    <th className="px-3 py-3 font-bold">Rounds</th>
                    <th className="px-3 py-3 font-bold">Avg Rating</th>
                    <th className="px-3 py-3 font-bold">Sentiment</th>
                    <th className="px-3 py-3 font-bold text-right">Overall</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {evaluated.map((r) => (
                    <tr key={r.candidateId} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-3 font-bold text-slate-400">{r.rank}</td>
                      <td className="px-3 py-3">
                        <span className="font-bold text-slate-900 block">{r.name}</span>
                        <span className="text-[10px] text-slate-500 font-medium">{r.candidateNumber}</span>
                      </td>
                      <td className="px-3 py-3 text-slate-600 font-medium">{r.job?.title || '—'}</td>
                      <td className="px-3 py-3 text-slate-700 font-semibold">{r.roundsEvaluated}</td>
                      <td className="px-3 py-3"><Stars value={r.averageRating} /></td>
                      <td className="px-3 py-3">
                        {r.sentiment ? (
                          <span className={SENTIMENT_STYLES[r.sentiment] || 'chip chip-blue'}>
                            {r.sentiment}
                          </span>
                        ) : '—'}
                      </td>
                      <td className={`px-3 py-3 text-right font-bold text-sm ${scoreColor(r.overallScore)}`}>
                        {r.overallScore ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-2.5 text-[11px] text-slate-500 border-t border-slate-100 bg-slate-50/30 font-medium">
              Overall score is calculated from panel recommendations (60%) and average rating scores (40%).
            </p>
          </div>

          {/* ---------------------------------------------- detail cards --- */}
          <div className="space-y-4">
            {evaluated.map((r) => {
              const open = expanded[r.candidateId];
              return (
                <div key={r.candidateId} className="card bg-white border border-sky-100 shadow-sm overflow-hidden rounded-2xl transition-all">
                  <button
                    onClick={() => setExpanded({ ...expanded, [r.candidateId]: !open })}
                    className="w-full px-5 py-4 flex items-center gap-4 hover:bg-slate-50/50 transition text-left cursor-pointer"
                  >
                    <span className="h-9 w-9 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center font-black text-sm shrink-0 shadow-sm">
                      {r.rank}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="font-bold text-base text-slate-900">{r.name}</span>
                      <span className="text-xs text-slate-500 font-medium ml-2">
                        {r.candidateNumber} • {r.job?.title || 'No role'}
                      </span>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {Object.entries(r.recommendations).map(([rec, n]) => (
                          <span key={rec} className={REC_STYLES[rec] || 'chip chip-blue'}>
                            {rec.replace('_', ' ')} ×{n}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`block text-lg font-bold ${scoreColor(r.overallScore)}`}>
                        {r.overallScore ?? '—'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-semibold uppercase">overall</span>
                    </div>
                    {open ? (
                      <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                    )}
                  </button>

                  {open && (
                    <div className="px-5 pb-5 border-t border-slate-100 pt-4 animate-fade-in">
                      {/* Key Strengths & Growth Areas */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                        <div className="p-3.5 rounded-xl bg-emerald-50/50 border border-emerald-100">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-900 flex items-center gap-1.5 mb-2">
                            <ThumbsUp className="h-3.5 w-3.5 text-emerald-600" /> Key Strengths
                          </span>
                          {r.aiStrengths.length === 0 ? (
                            <span className="text-[11px] text-slate-400 font-medium">None noted</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {r.aiStrengths.map((s) => (
                                <span key={s} className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold border border-emerald-200">
                                  {s}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="p-3.5 rounded-xl bg-amber-50/50 border border-amber-100">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5 mb-2">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Areas for Growth
                          </span>
                          {r.aiSkillGaps.length === 0 ? (
                            <span className="text-[11px] text-slate-400 font-medium">None noted</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {r.aiSkillGaps.map((s) => (
                                <span key={s} className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold border border-amber-200">
                                  {s}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {r.aiNextRoundFocus.length > 0 && (
                        <div className="mb-5 p-3.5 rounded-xl bg-sky-50/50 border border-sky-100">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-sky-900 flex items-center gap-1.5 mb-2">
                            <Cpu className="h-3.5 w-3.5 text-sky-600" /> Suggested Next Round Focus
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {r.aiNextRoundFocus.map((s) => (
                              <span key={s} className="px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800 text-[11px] font-semibold border border-sky-200">
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* per-round detail */}
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-2">
                        Interviewer Scorecards & Feedback
                      </span>
                      <div className="space-y-3">
                        {r.rounds.map((rd) => (
                          <div
                            key={rd.interviewId}
                            className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200"
                          >
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span className="font-bold text-xs text-slate-900">
                                {rd.roundName || 'Interview'}
                              </span>
                              <span className="chip chip-blue text-[10px]">
                                {rd.interviewType}
                              </span>
                              <span className={REC_STYLES[rd.recommendation] || 'chip chip-blue'}>
                                {rd.recommendation?.replace('_', ' ')}
                              </span>
                              {rd.ai.sentiment && (
                                <span className={SENTIMENT_STYLES[rd.ai.sentiment] || 'chip chip-blue'}>
                                  {rd.ai.sentiment}
                                </span>
                              )}
                              <span className="ml-auto text-[10px] text-slate-500 font-medium">
                                {rd.interviewerName}
                                {rd.submittedAt
                                  ? ` • ${DateTime.fromISO(rd.submittedAt).toFormat('LLL dd, HH:mm')}`
                                  : ''}
                              </span>
                            </div>

                            <div className="mb-2"><Stars value={rd.overallRating} /></div>

                            {Object.keys(rd.ratings).length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mb-2">
                                {Object.entries(rd.ratings).map(([k, v]) => (
                                  <span
                                    key={k}
                                    className="px-2 py-0.5 rounded-md border border-slate-200 bg-white text-slate-700 text-xs font-semibold shadow-2xs"
                                    title={`${k}: ${v} of 5`}
                                  >
                                    {k}: <strong className="ml-1 text-slate-900 font-bold">{v}</strong>
                                  </span>
                                ))}
                              </div>
                            )}

                            {rd.ai.summary && (
                              <p className="text-[11px] text-purple-900 bg-purple-50 border border-purple-200 rounded-xl p-2.5 mb-2 font-medium leading-relaxed">
                                <strong className="font-bold text-purple-900">Summary Highlights:</strong> {rd.ai.summary}
                              </p>
                            )}

                            {rd.comments && (
                              <p className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-line font-normal">
                                {rd.comments}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* awaiting feedback */}
      {!loading && pending.length > 0 && (
        <div className="card p-5 bg-white border border-sky-100 shadow-sm mt-6 rounded-2xl">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5 mb-3">
            <Users className="h-4 w-4 text-purple-600" />
            Awaiting Interviewer Feedback ({pending.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {pending.map((p) => (
              <span
                key={p.candidateId}
                className="px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700 text-xs font-medium"
                title={p.job?.title || 'No role'}
              >
                {p.candidateNumber} — {p.name}
              </span>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-3 font-medium">
            These candidates have completed interviews, but interviewers have not yet submitted their scorecards.
          </p>
        </div>
      )}
    </div>
  );
}
