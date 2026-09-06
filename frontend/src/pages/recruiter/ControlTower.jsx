import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Zap,
  ArrowRight,
  UserCheck,
  Clock,
  Shield,
  Layers,
  ChevronRight,
  Sliders,
} from 'lucide-react';
import { DateTime } from 'luxon';

export default function ControlTower() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingIncidentId, setActingIncidentId] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  useEffect(() => {
    loadIncidents();
  }, []);

  async function loadIncidents() {
    setLoading(true);
    try {
      const data = await api.get('/control-tower/incidents');
      setIncidents(data || []);
    } catch (err) {
      console.error('Failed to load incidents:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprovePlan(incidentId, planId) {
    setActingIncidentId(incidentId);
    setActionSuccess(null);
    try {
      await api.post(`/control-tower/incidents/${incidentId}/approve`, { planId });
      setActionSuccess('Recovery plan approved and applied! Schedule healed.');
      await loadIncidents();
    } catch (err) {
      console.error('Approval failed:', err);
      alert(err.message || 'Failed to apply recovery plan');
    } finally {
      setActingIncidentId(null);
    }
  }

  function getSeverityBadge(severity) {
    switch (severity) {
      case 'CRITICAL':
        return 'bg-red-100 text-red-900 border-red-300';
      case 'HIGH':
        return 'bg-rose-100 text-rose-800 border-rose-200';
      case 'MEDIUM':
        return 'bg-amber-100 text-amber-900 border-amber-200';
      default:
        return 'bg-sky-100 text-sky-800 border-sky-200';
    }
  }

  function getRiskBadge(risk) {
    switch (risk) {
      case 'LOW':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'MEDIUM':
        return 'bg-amber-100 text-amber-900 border-amber-200';
      default:
        return 'bg-rose-100 text-rose-900 border-rose-200';
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <ShieldAlert className="h-7 w-7 text-rose-600" />
            Control Tower & Self-Healing Monitor
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Minimum Deliverable 7 • Continuous disruption detection, cascade impact analysis & bounded recovery autonomy
          </p>
        </div>
        <button
          onClick={loadIncidents}
          className="btn-ghost text-xs py-2 px-3 text-slate-600 flex items-center gap-1.5 self-start sm:self-auto"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh Incidents
        </button>
      </div>

      {/* Autonomy Policy Banner */}
      <div className="card p-4 bg-white border border-sky-100 shadow-sm mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-sky-100 text-brand-700">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <span className="font-bold text-xs text-slate-900 block">
              Active Autonomy Policy: <span className="text-emerald-700">LOW_RISK_AUTO_APPLY</span>
            </span>
            <p className="text-[11px] text-slate-500">
              Low-risk replacements & shifts are applied autonomously; medium/high risk disruption plans wait for recruiter approval.
            </p>
          </div>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0">
          Guardrails Active
        </span>
      </div>

      {/* Success Notification */}
      {actionSuccess && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Incidents List */}
      <div className="space-y-6">
        {incidents.length === 0 && !loading && (
          <div className="card p-16 text-center bg-white border border-sky-100">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">All Systems Nominal</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              Zero active incidents or scheduling conflicts detected. The background monitor polls every 60 seconds to detect cancellations, overruns, and panel dropouts.
            </p>
          </div>
        )}

        {incidents.map((inc) => {
          const isActing = actingIncidentId === inc.id;
          const plans = inc.plans || [];
          const bestPlan = plans.find((p) => p.isRecommended) || plans[0];

          return (
            <div
              key={inc.id}
              className="card bg-white border border-slate-200/80 shadow-sm overflow-hidden"
            >
              {/* Incident Header */}
              <div className="p-5 border-b border-slate-100 bg-sky-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-rose-100 text-rose-700 shrink-0 mt-0.5">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded border ${getSeverityBadge(
                          inc.severity
                        )}`}
                      >
                        {inc.severity} SEVERITY
                      </span>
                      <span className="text-xs font-bold text-slate-800">{inc.type}</span>
                      <span className="text-[11px] text-slate-400">
                        • Detected {DateTime.fromISO(inc.detectedAt).toRelative()}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mt-1">{inc.title}</h3>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      {inc.description}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                    Status: {inc.status}
                  </span>
                </div>
              </div>

              {/* Recovery Options Section */}
              <div className="p-5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-purple-600" />
                  Self-Healing Recovery Plans ({plans.length})
                </h4>

                {plans.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    Control Tower analyzing available recovery alternatives...
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {plans.map((p, pIdx) => {
                      const isRec = p.isRecommended || p.id === bestPlan?.id;
                      return (
                        <div
                          key={p.id || pIdx}
                          className={`p-4 rounded-xl border transition flex flex-col justify-between ${
                            isRec
                              ? 'border-brand-300 bg-sky-50/50 shadow-xs'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span
                                className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded border ${getRiskBadge(
                                  p.riskLevel
                                )}`}
                              >
                                {p.riskLevel} RISK
                              </span>
                              {isRec && (
                                <span className="text-[10px] font-extrabold uppercase text-brand-700 bg-white px-2 py-0.5 rounded border border-brand-200">
                                  ★ Recommended
                                </span>
                              )}
                            </div>
                            <h5 className="font-bold text-sm text-slate-900">{p.description}</h5>
                            <div className="mt-2 text-[11px] text-slate-500 space-y-0.5">
                              <div>Strategy: <strong className="text-slate-700">{p.strategy}</strong></div>
                              <div>Disruption score: <strong>{p.disruptionScore || 15}m</strong></div>
                            </div>
                          </div>

                          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-end">
                            {inc.status === 'RESOLVED' ? (
                              <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                                <CheckCircle2 className="h-4 w-4" /> Plan Applied
                              </span>
                            ) : (
                              <button
                                onClick={() => handleApprovePlan(inc.id, p.id)}
                                disabled={isActing}
                                className={`text-xs py-1.5 px-3.5 font-bold rounded-lg transition ${
                                  isRec
                                    ? 'btn-primary shadow-xs'
                                    : 'btn-ghost'
                                }`}
                              >
                                {isActing ? 'Applying...' : 'Approve & Apply Plan'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
