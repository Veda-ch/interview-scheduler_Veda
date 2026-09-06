import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  BarChart3,
  Shield,
  Clock,
  UserCheck,
  Search,
  RefreshCw,
  FileText,
  Filter,
} from 'lucide-react';
import { DateTime } from 'luxon';

const COLORS = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

export default function AnalyticsView() {
  const [utilizationData, setUtilizationData] = useState([]);
  const [healthData, setHealthData] = useState([]);
  const [funnelData, setFunnelData] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [auditFilter, setAuditFilter] = useState('');

  useEffect(() => {
    loadAnalytics();
  }, []);

  async function loadAnalytics() {
    setLoading(true);
    try {
      const [util, health, funnel, logs] = await Promise.all([
        api.get('/analytics/interviewer-utilization').catch(() => []),
        api.get('/analytics/health-distribution').catch(() => null),
        api.get('/analytics/funnel').catch(() => null),
        api.get('/audit-logs?take=50').catch(() => null),
      ]);

      // /interviewer-utilization returns a bare array of shaped interviewers.
      setUtilizationData(
        (util || []).map((u) => ({
          name: u.name?.split(' ')[0] || 'Interviewer',
          interviews: u.upcomingCount ?? 0,
          max: u.maxPerWeek ?? 10,
        }))
      );

      // /health-distribution returns { buckets: [{ range, count }], total, worst }.
      setHealthData(
        (health?.buckets || []).map((b) => ({ name: b.range, count: b.count }))
      );

      // /funnel returns a keyed object, not chart rows - project it into stages.
      setFunnelData(
        funnel
          ? [
              { stage: 'Applications', count: funnel.applications ?? 0 },
              { stage: 'Rounds Requested', count: funnel.roundsRequested ?? 0 },
              { stage: 'Interviews Scheduled', count: funnel.interviewsScheduled ?? 0 },
              { stage: 'Completed', count: funnel.byStatus?.COMPLETED ?? 0 },
            ]
          : []
      );

      // /audit-logs returns { total, items }.
      setAuditLogs(logs?.items || []);
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setLoading(false);
    }
  }

  const filteredLogs = auditLogs.filter(
    (l) =>
      l.summary?.toLowerCase().includes(auditFilter.toLowerCase()) ||
      l.action?.toLowerCase().includes(auditFilter.toLowerCase()) ||
      l.actorRole?.toLowerCase().includes(auditFilter.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Top Banner */}
      <div className="card p-6 bg-gradient-to-r from-purple-50 via-white to-sky-50/50 border border-sky-100 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-purple-500/20 shrink-0">
              <BarChart3 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                Analytics & Logs
              </h1>
            </div>
          </div>
          <button
            onClick={loadAnalytics}
            className="btn-secondary text-xs px-3.5 py-2 flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-slate-600 ${loading ? 'animate-spin' : ''}`} /> Refresh Metrics
          </button>
        </div>
      </div>

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Chart 1: Interviewer Utilization */}
        <div className="card p-6 bg-white border border-sky-100 shadow-sm rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Interviewer Weekly Workload</h3>
            </div>
            <span className="chip chip-purple text-[10px] font-bold uppercase tracking-wider">
              Workload Balance
            </span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={utilizationData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
                    color: '#0f172a',
                    fontWeight: 600,
                  }}
                />
                <Bar dataKey="interviews" fill="#7c3aed" radius={[6, 6, 0, 0]} name="Interviews This Week" />
                <Bar dataKey="max" fill="#e2e8f0" radius={[6, 6, 0, 0]} name="Max Capacity" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Schedule Health Distribution */}
        <div className="card p-6 bg-white border border-sky-100 shadow-sm rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Schedule Health Breakdown</h3>
            </div>
            <span className="chip chip-blue text-[10px] font-bold uppercase tracking-wider">
              Health Metric
            </span>
          </div>
          <div className="h-64 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={healthData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={4}
                  dataKey="count"
                  nameKey="name"
                >
                  {healthData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
                    color: '#0f172a',
                    fontWeight: 600,
                  }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="card bg-white border border-sky-100 shadow-sm overflow-hidden rounded-2xl">
        <div className="p-5 border-b border-slate-100 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-sm">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Activity & Change Log</h3>
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
              placeholder="Search activity log..."
              className="input pl-9 py-2 text-xs border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-purple-600 focus:ring-purple-100"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Action & Event</th>
                <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Summary</th>
                <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">User Role</th>
                <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Entity</th>
                <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-slate-400 text-xs font-medium">
                    No activity records match your filter.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60 transition-colors text-xs">
                    <td className="px-5 py-3.5">
                      <span className="font-semibold text-slate-900 block">{log.action}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-slate-700 font-normal">{log.summary}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                        {log.actorRole}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-600 font-medium">{log.entity}</td>
                    <td className="px-5 py-3.5 text-right text-slate-500 font-medium">
                      {DateTime.fromISO(log.createdAt).toFormat('LLL dd, HH:mm:ss')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
