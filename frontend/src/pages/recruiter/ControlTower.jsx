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
      // Include resolved ones: the page's whole point is showing what the system
      // did on its own, and an incident it recovered without asking is exactly
      // that. Open incidents still sort first.
      const data = await api.get('/control-tower/incidents?includeResolved=true');
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
        return 'chip chip-red text-[10px] font-bold';
      case 'HIGH':
        return 'chip chip-amber text-[10px] font-bold';
      case 'MEDIUM':
        return 'chip chip-blue text-[10px] font-semibold';
      default:
        return 'chip border-slate-200 bg-slate-50 text-slate-700 text-[10px] font-semibold';
    }
  }

  function getRiskBadge(risk) {
    switch (risk) {
      case 'LOW':
        return 'chip chip-green text-[10px] font-bold';
      case 'MEDIUM':
        return 'chip chip-amber text-[10px] font-bold';
      default:
        return 'chip chip-red text-[10px] font-bold';
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Top Banner */}
      <div className="card p-6 bg-gradient-to-r from-purple-50 via-white to-sky-50/50 border border-sky-100 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center font-extrabold text-lg shadow-sm">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-purple-800 bg-purple-100/70 px-2.5 py-0.5 rounded-full border border-purple-200">
                System Monitoring
              </span>
              <h1 className="text-2xl font-extrabold text-slate-900 mt-1">
                Schedule Health & Conflict Monitor
              </h1>
            </div>
          </div>
          <button
            onClick={loadIncidents}
            className="btn-secondary text-xs py-2 px-3.5 flex items-center gap-1.5 font-bold self-start sm:self-auto"
          >
            <RefreshCw className={`h-4 w-4 text-purple-600 ${loading ? 'animate-spin' : ''}`} /> Refresh Alerts
          </button>
        </div>
      </div>

      {/* Autonomy Policy Banner */}
      <div className="card p-4 bg-white border border-sky-100 shadow-sm mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600 border border-purple-100">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <span className="font-bold text-xs text-slate-900 block">
              Smart Rescheduling: <span className="text-purple-700 font-extrabold">Auto-Resolve Low-Impact Changes</span>
            </span>
          </div>
        </div>
        <span className="chip chip-green font-bold shrink-0">
          Protection Active
        </span>
      </div>

      {/* Success Notification */}
      {actionSuccess && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2.5 animate-fade-in shadow-xs">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Incidents List */}
      <div className="space-y-6">
        {incidents.length === 0 && !loading && (
          <div className="card p-16 text-center bg-white border border-sky-100 rounded-2xl shadow-xs">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center mb-3">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">All Systems Nominal</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 font-medium">
              Zero active scheduling conflicts or calendar overlaps. The monitor continuously checks for cancellations, delays, and panel changes.
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
              className="card bg-white border border-sky-100 shadow-sm overflow-hidden rounded-2xl transition-all"
            >
              {/* Incident Header */}
              <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 shrink-0 mt-0.5">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={getSeverityBadge(inc.severity)}>
                        {inc.severity} PRIORITY
                      </span>
                      <span className="text-xs font-bold text-slate-900">{inc.type}</span>
                      <span className="text-[11px] text-slate-500 font-medium">
                        • Detected {DateTime.fromISO(inc.detectedAt).toRelative()}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mt-1">{inc.title}</h3>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed font-medium">
                      {inc.description}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <span className="chip border-slate-200 bg-white text-slate-700 font-semibold shadow-xs">
                    Status: {inc.status}
                  </span>
                </div>
              </div>

              {/* Recovery Options Section */}
              <div className="p-5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3.5 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-purple-600" />
                  Recommended Resolution Plans ({plans.length})
                </h4>

                {plans.length === 0 ? (
                  <p className="text-xs text-slate-500 font-medium">
                    Searching for available alternative interviewers and time slots...
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {plans.map((p, pIdx) => {
                      const isRec = p.isRecommended || p.id === bestPlan?.id;
                      return (
                        <div
                          key={p.id || pIdx}
                          className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
                            isRec
                              ? 'border-purple-200 bg-purple-50/40 shadow-xs'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className={getRiskBadge(p.riskLevel)}>
                                {p.riskLevel} RISK
                              </span>
                              {isRec && (
                                <span className="chip chip-purple text-[10px]">
                                  ★ Recommended
                                </span>
                              )}
                            </div>
                            <h5 className="font-bold text-sm text-slate-900">{p.description}</h5>
                            <div className="mt-2.5 text-[11px] text-slate-500 space-y-0.5 font-medium">
                              <div>Strategy: <strong className="text-slate-800 font-bold">{p.strategy}</strong></div>
                              <div>Schedule impact: <strong className="text-slate-800 font-bold">{p.disruptionScore || 15} min</strong></div>
                            </div>
                          </div>

                          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-end">
                            {inc.status === 'RESOLVED' ? (
                              <span className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Plan Applied
                              </span>
                            ) : (
                              <button
                                onClick={() => handleApprovePlan(inc.id, p.id)}
                                disabled={isActing}
                                className={`text-xs py-1.5 px-3.5 font-bold rounded-xl transition-all ${
                                  isRec
                                    ? 'btn-primary shadow-xs'
                                    : 'btn-secondary'
                                }`}
                              >
                                {isActing ? 'Applying...' : 'Accept & Reschedule'}
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
