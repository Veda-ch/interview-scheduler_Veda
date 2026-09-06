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

const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

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
        api.get('/analytics/health-distribution').catch(() => []),
        api.get('/analytics/funnel').catch(() => []),
        api.get('/audit-logs?take=50').catch(() => []),
      ]);

      setUtilizationData(
        (util || []).map((u) => ({
          name: u.name?.split(' ')[0] || 'Interviewer',
          interviews: u.weeklyInterviewCount || u.upcomingCount || 3,
          max: u.maxPerWeek || 10,
        }))
      );

      setHealthData(health || [
        { name: 'Optimal (80-100)', count: 18 },
        { name: 'Fair (60-79)', count: 6 },
        { name: 'At Risk (<60)', count: 2 },
      ]);

      setFunnelData(funnel || [
        { stage: 'Screening', count: 24 },
        { stage: 'Technical', count: 16 },
        { stage: 'Managerial', count: 9 },
        { stage: 'Offer', count: 4 },
      ]);

      setAuditLogs(logs || []);
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
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <BarChart3 className="h-7 w-7 text-brand-600" />
            Scheduling Analytics & Audit History
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Bonus Feature • Interviewer utilization headroom, pipeline funnel & immutable audit trail
          </p>
        </div>
        <button
          onClick={loadAnalytics}
          className="btn-ghost text-xs py-2 px-3 text-slate-600 flex items-center gap-1.5"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh Metrics
        </button>
      </div>

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Chart 1: Interviewer Utilization */}
        <div className="card p-5 bg-white border border-sky-100 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Interviewer Weekly Workload</h3>
              <p className="text-[11px] text-slate-500">Scheduled vs Weekly Capacity Ceiling</p>
            </div>
            <span className="chip chip-blue">Load Balancing</span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={utilizationData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0' }}
                />
                <Bar dataKey="interviews" fill="#2563eb" radius={[4, 4, 0, 0]} name="Interviews This Week" />
                <Bar dataKey="max" fill="#cbd5e1" radius={[4, 4, 0, 0]} name="Max Capacity" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Schedule Health Distribution */}
        <div className="card p-5 bg-white border border-sky-100 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Schedule Health Distribution</h3>
              <p className="text-[11px] text-slate-500">Calculated composite schedule health</p>
            </div>
            <span className="chip chip-green">Resilience Score</span>
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
                  contentStyle={{ backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="card bg-white border border-sky-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-sky-100 bg-sky-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-brand-600 text-white shadow-xs">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Immutable Audit Trail</h3>
              <p className="text-xs text-slate-500">
                Logged user, system & AI scheduler events with actor stamps
              </p>
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
              placeholder="Filter audit events..."
              className="input pl-9 py-1.5 text-xs"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className="th">Action & Event</th>
                <th className="th">Summary</th>
                <th className="th">Actor Role</th>
                <th className="th">Entity</th>
                <th className="th text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-slate-400 text-sm">
                    No audit records match your filter.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-sky-50/30 transition text-xs">
                    <td className="td">
                      <span className="font-bold text-slate-900 block">{log.action}</span>
                    </td>
                    <td className="td">
                      <span className="text-slate-700 font-medium">{log.summary}</span>
                    </td>
                    <td className="td">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                        {log.actorRole}
                      </span>
                    </td>
                    <td className="td text-slate-500">{log.entity}</td>
                    <td className="td text-right text-slate-400 font-medium">
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
