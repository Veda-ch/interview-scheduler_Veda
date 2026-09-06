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
  STRONG_YES: 'chip-green',
  YES: 'chip-green',
  NEUTRAL: 'chip-amber',
  NO: 'chip-red',
  STRONG_NO: 'chip-red',
};

const SENTIMENT_STYLES = {
  POSITIVE: 'chip-green',
  MIXED: 'chip-amber',
  NEGATIVE: 'chip-red',
};

function scoreColor(score) {
  if (score == null) return 'text-slate-400';
  if (score >= 75) return 'text-emerald-700';
  if (score >= 50) return 'text-amber-700';
  return 'text-rose-700';
}

function Stars({ value }) {
  if (value == null) return <span className="text-slate-400 text-[11px]">no rating</span>;
  return (
    <span className="inline-flex items-center gap-0.5" title={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-3.5 w-3.5 ${
            n <= Math.round(value) ? 'text-amber-500 fill-amber-500' : 'text-slate-200'
          }`}
        />
      ))}
      <span className="ml-1 text-[11px] font-bold text-slate-700">{value}</span>
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Trophy className="h-6 w-6 text-amber-600" />
            Candidate Evaluations & Ranking
          </h1>
          <p className="text-xs text-slate-600 mt-1">
            Interviewer feedback as analysed by the AI agent, ranked for comparison.
          </p>
        </div>
        <button
          onClick={load}
          className="btn-secondary text-xs py-2 px-3.5 flex items-center gap-1.5 shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center">
          <div className="h-8 w-8 rounded-full border-4 border-brand-600 border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-xs font-bold text-slate-600">Loading evaluations...</p>
        </div>
      ) : evaluated.length === 0 ? (
        <div className="card p-12 text-center bg-white border border-sky-100">
          <Cpu className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700">No feedback analysed yet</p>
          <p className="text-xs text-slate-500 mt-1">
            Once an interviewer submits feedback, the AI analysis appears here and candidates get ranked.
          </p>
        </div>
      ) : (
        <>
          {/* ------------------------------------------ comparison table --- */}
          <div className="card bg-white border border-sky-100 shadow-sm mb-6 overflow-hidden">
            <div className="px-5 py-3 border-b border-sky-100 bg-sky-50/50">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Target className="h-4 w-4 text-brand-600" />
                Side-by-Side Comparison ({evaluated.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-sky-100">
                    <th className="px-5 py-2.5 font-bold">#</th>
                    <th className="px-3 py-2.5 font-bold">Candidate</th>
                    <th className="px-3 py-2.5 font-bold">Role</th>
                    <th className="px-3 py-2.5 font-bold">Rounds</th>
                    <th className="px-3 py-2.5 font-bold">Avg Rating</th>
                    <th className="px-3 py-2.5 font-bold">Sentiment</th>
                    <th className="px-3 py-2.5 font-bold text-right">Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluated.map((r) => (
                    <tr key={r.candidateId} className="border-b border-sky-50 hover:bg-sky-50/40">
                      <td className="px-5 py-3 font-extrabold text-slate-400">{r.rank}</td>
                      <td className="px-3 py-3">
                        <span className="font-bold text-slate-900 block">{r.name}</span>
                        <span className="text-[10px] text-slate-500">{r.candidateNumber}</span>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{r.job?.title || '—'}</td>
                      <td className="px-3 py-3 text-slate-600">{r.roundsEvaluated}</td>
                      <td className="px-3 py-3"><Stars value={r.averageRating} /></td>
                      <td className="px-3 py-3">
                        {r.sentiment ? (
                          <span className={`chip ${SENTIMENT_STYLES[r.sentiment] || 'chip-blue'}`}>
                            {r.sentiment}
                          </span>
                        ) : '—'}
                      </td>
                      <td className={`px-3 py-3 text-right font-extrabold text-sm ${scoreColor(r.overallScore)}`}>
                        {r.overallScore ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-2.5 text-[10px] text-slate-500 border-t border-sky-100 bg-slate-50/50">
              Overall = 60% panel recommendation + 40% average rating, both normalised to 100.
            </p>
          </div>

          {/* ---------------------------------------------- detail cards --- */}
          <div className="space-y-4">
            {evaluated.map((r) => {
              const open = expanded[r.candidateId];
              return (
                <div key={r.candidateId} className="card bg-white border border-sky-100 shadow-sm overflow-hidden">
                  <button
                    onClick={() => setExpanded({ ...expanded, [r.candidateId]: !open })}
                    className="w-full px-5 py-4 flex items-center gap-4 hover:bg-sky-50/40 transition text-left"
                  >
                    <span className="h-9 w-9 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 text-white flex items-center justify-center font-extrabold text-sm shrink-0">
                      {r.rank}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="font-extrabold text-sm text-slate-900">{r.name}</span>
                      <span className="text-[11px] text-slate-500 ml-2">
                        {r.candidateNumber} • {r.job?.title || 'No role'}
                      </span>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {Object.entries(r.recommendations).map(([rec, n]) => (
                          <span key={rec} className={`chip ${REC_STYLES[rec] || 'chip-blue'}`}>
                            {rec.replace('_', ' ')} ×{n}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`block text-lg font-extrabold ${scoreColor(r.overallScore)}`}>
                        {r.overallScore ?? '—'}
                      </span>
                      <span className="text-[10px] text-slate-400">overall</span>
                    </div>
                    {open ? (
                      <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                    )}
                  </button>

                  {open && (
                    <div className="px-5 pb-5 border-t border-sky-100 pt-4 animate-fade-in">
                      {/* AI aggregate */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                        <div className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-100">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5 mb-2">
                            <ThumbsUp className="h-3.5 w-3.5" /> AI-identified strengths
                          </span>
                          {r.aiStrengths.length === 0 ? (
                            <span className="text-[11px] text-slate-500">None identified</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {r.aiStrengths.map((s) => (
                                <span key={s} className="chip chip-green">{s}</span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-100">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5 mb-2">
                            <AlertTriangle className="h-3.5 w-3.5" /> AI-identified gaps
                          </span>
                          {r.aiSkillGaps.length === 0 ? (
                            <span className="text-[11px] text-slate-500">None identified</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {r.aiSkillGaps.map((s) => (
                                <span key={s} className="chip chip-amber">{s}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {r.aiNextRoundFocus.length > 0 && (
                        <div className="mb-5 p-3.5 rounded-xl bg-purple-50/60 border border-purple-100">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-900 flex items-center gap-1.5 mb-2">
                            <Cpu className="h-3.5 w-3.5" /> Recommended focus for the next round
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {r.aiNextRoundFocus.map((s) => (
                              <span key={s} className="chip chip-purple">{s}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* per-round detail */}
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-2">
                        Round-by-round feedback
                      </span>
                      <div className="space-y-3">
                        {r.rounds.map((rd) => (
                          <div
                            key={rd.interviewId}
                            className="p-3.5 rounded-xl bg-sky-50/40 border border-sky-100"
                          >
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span className="font-bold text-xs text-slate-900">
                                {rd.roundName || 'Interview'}
                              </span>
                              <span className="chip chip-blue">{rd.interviewType}</span>
                              <span className={`chip ${REC_STYLES[rd.recommendation] || 'chip-blue'}`}>
                                {rd.recommendation?.replace('_', ' ')}
                              </span>
                              {rd.ai.sentiment && (
                                <span className={`chip ${SENTIMENT_STYLES[rd.ai.sentiment] || 'chip-blue'}`}>
                                  {rd.ai.sentiment}
                                </span>
                              )}
                              <span className="ml-auto text-[10px] text-slate-500">
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
                                    className="chip border-slate-200 bg-white text-slate-700"
                                    title={`${k}: ${v} of 5`}
                                  >
                                    {k} <strong className="ml-1">{v}</strong>
                                  </span>
                                ))}
                              </div>
                            )}

                            {rd.ai.summary && (
                              <p className="text-[11px] text-purple-900 bg-purple-50/70 border border-purple-100 rounded-lg p-2.5 mb-2">
                                <strong className="font-bold">AI summary</strong>
                                {rd.ai.providerUsed ? ` (${rd.ai.providerUsed})` : ''}: {rd.ai.summary}
                              </p>
                            )}

                            {rd.comments && (
                              <p className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-line">
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
        <div className="card p-5 bg-white border border-sky-100 shadow-sm mt-6">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5 mb-3">
            <Users className="h-4 w-4 text-slate-400" />
            Awaiting Feedback ({pending.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {pending.map((p) => (
              <span
                key={p.candidateId}
                className="chip border-slate-200 bg-slate-50 text-slate-600"
                title={p.job?.title || 'No role'}
              >
                {p.candidateNumber} — {p.name}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-3">
            These candidates have no submitted interviewer feedback yet, so they cannot be ranked.
          </p>
        </div>
      )}
    </div>
  );
}
