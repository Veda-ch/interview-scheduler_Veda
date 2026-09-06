import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import TimezoneCard from '../../components/TimezoneCard.jsx';
import {
  Clock,
  Sparkles,
  Calendar,
  CheckCircle2,
  Trash2,
  Plus,
  AlertCircle,
  HelpCircle,
  RefreshCw,
} from 'lucide-react';
import { DateTime } from 'luxon';

/**
 * If two available slots overlap, filter out the shorter one.
 * Blackout windows (UNAVAILABLE) are preserved.
 */
function filterNonRedundantWindows(rawWindows) {
  if (!rawWindows || !rawWindows.length) return [];

  const sorted = [...rawWindows].sort((a, b) => {
    const aStart = new Date(a.startUtc).getTime();
    const bStart = new Date(b.startUtc).getTime();
    if (aStart !== bStart) return aStart - bStart;
    const aDur = new Date(a.endUtc).getTime() - aStart;
    const bDur = new Date(b.endUtc).getTime() - bStart;
    return bDur - aDur;
  });

  return sorted.filter((w, idx) => {
    if (w.kind === 'UNAVAILABLE') return true;

    const wStart = new Date(w.startUtc).getTime();
    const wEnd = new Date(w.endUtc).getTime();
    const wDuration = wEnd - wStart;

    const hasLongerOverlapping = sorted.some((other, otherIdx) => {
      if (otherIdx === idx) return false;
      if (other.kind === 'UNAVAILABLE') return false;

      const oStart = new Date(other.startUtc).getTime();
      const oEnd = new Date(other.endUtc).getTime();
      const doesOverlap = wStart < oEnd && oStart < wEnd;
      if (!doesOverlap) return false;

      const oDuration = oEnd - oStart;
      if (oDuration > wDuration) return true;
      if (oDuration === wDuration && otherIdx < idx) return true;

      return false;
    });

    return !hasLongerOverlapping;
  });
}

export default function AvailabilityPicker() {
  const { user } = useAuth();
  const [windows, setWindows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nlpText, setNlpText] = useState('');
  const [parsingNlp, setParsingNlp] = useState(false);
  const [nlpResult, setNlpResult] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Manual window form state
  const [date, setDate] = useState(DateTime.now().plus({ days: 1 }).toISODate());
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('14:00');
  const [kind, setKind] = useState('AVAILABLE');

  const displayedWindows = filterNonRedundantWindows(windows);

  useEffect(() => {
    loadAvailability();
  }, []);

  async function loadAvailability() {
    setLoading(true);
    try {
      const data = await api.get('/candidates/me/availability');
      setWindows(data || []);
    } catch (err) {
      console.error('Failed to load availability:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddWindow(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const startDt = DateTime.fromISO(`${date}T${startTime}`, {
        zone: user?.timezone || 'UTC',
      });
      const endDt = DateTime.fromISO(`${date}T${endTime}`, {
        zone: user?.timezone || 'UTC',
      });

      if (endDt <= startDt) {
        setError('End time must be after start time.');
        setSaving(false);
        return;
      }

      const startUtc = startDt.toUTC().toISO();
      const endUtc = endDt.toUTC().toISO();
      const newStartMs = startDt.toMillis();
      const newEndMs = endDt.toMillis();
      const newDur = newEndMs - newStartMs;

      // If adding an available/preferred slot, check against existing windows
      if (kind !== 'UNAVAILABLE') {
        const overlapping = windows.filter((w) => {
          if (w.kind === 'UNAVAILABLE') return false;
          const wStart = new Date(w.startUtc).getTime();
          const wEnd = new Date(w.endUtc).getTime();
          return newStartMs < wEnd && wStart < newEndMs;
        });

        // 1. If an existing overlapping slot is longer or equal, no need to show/add shorter slot
        const longerExisting = overlapping.find((w) => {
          const wDur = new Date(w.endUtc).getTime() - new Date(w.startUtc).getTime();
          return wDur >= newDur;
        });

        if (longerExisting) {
          const existingStart = DateTime.fromISO(longerExisting.startUtc, { zone: user?.timezone || 'UTC' }).toFormat('hh:mm a');
          const existingEnd = DateTime.fromISO(longerExisting.endUtc, { zone: user?.timezone || 'UTC' }).toFormat('hh:mm a');
          setSuccess(
            `A longer overlapping available slot (${existingStart} – ${existingEnd}) already covers this time. Shorter slot omitted.`
          );
          setSaving(false);
          return;
        }

        // 2. If newly entered slot is longer than existing overlapping slots, remove the shorter ones
        const shorterExisting = overlapping.filter((w) => {
          const wDur = new Date(w.endUtc).getTime() - new Date(w.startUtc).getTime();
          return wDur < newDur;
        });

        if (shorterExisting.length > 0) {
          await Promise.all(
            shorterExisting.map((w) => api.del(`/candidates/me/availability/${w.id}`).catch(() => {}))
          );
        }
      }

      await api.post('/candidates/me/availability', {
        windows: [{ startUtc, endUtc, kind, timezone: user?.timezone || 'UTC' }],
        mode: 'append',
      });

      setSuccess('Availability window added successfully!');
      loadAvailability();
    } catch (err) {
      setError(err.message || 'Failed to add availability window');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteWindow(windowId) {
    try {
      await api.del(`/candidates/me/availability/${windowId}`);
      setWindows(windows.filter((w) => w.id !== windowId));
    } catch (err) {
      console.error('Failed to delete window:', err);
    }
  }

  async function handleParseNaturalLanguage(e) {
    e.preventDefault();
    if (!nlpText.trim()) return;

    setParsingNlp(true);
    setError(null);
    setNlpResult(null);

    try {
      const res = await api.post('/candidates/me/availability/natural', {
        text: nlpText,
        apply: true,
      });

      setNlpResult(res);
      setSuccess('Natural language availability parsed and applied!');
      loadAvailability();
    } catch (err) {
      setError(err.message || 'Failed to parse natural language availability');
    } finally {
      setParsingNlp(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Clock className="h-6 w-6 text-brand-600" />
          My Interview Availability
        </h1>
        <p className="text-xs text-slate-600 mt-1">
          Minimum Deliverable 3 • Provide your available hours using interactive picker or natural English
        </p>
      </div>

      {success && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center gap-2 animate-fade-in">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 2-Column Section */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Left Column: Natural Language AI Parser (5 Cols) */}
        <div className="md:col-span-6 space-y-6">
          <TimezoneCard note="Windows you enter below are read in this zone, then stored in UTC." />

          <div className="card p-5 bg-white border border-sky-100 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded-lg bg-brand-100 text-brand-700">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Describe Your Availability
                </h3>
                <p className="text-[11px] text-slate-500">
                  Type your free hours or preferred days in plain language
                </p>
              </div>
            </div>

            <form onSubmit={handleParseNaturalLanguage} className="mt-3 space-y-3">
              <textarea
                value={nlpText}
                onChange={(e) => setNlpText(e.target.value)}
                placeholder="e.g. I am available weekdays between 10am and 4pm, but avoid Wednesday after 2pm and no Friday afternoons."
                rows={4}
                className="input text-xs font-medium leading-relaxed resize-none"
                required
              />

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400">
                  Converted into structured time slots
                </span>
                <button
                  type="submit"
                  disabled={parsingNlp}
                  className="btn-primary text-xs py-2 px-4 shadow-xs flex items-center gap-1.5"
                >
                  <Clock className={`h-3.5 w-3.5 ${parsingNlp ? 'animate-spin' : ''}`} />
                  {parsingNlp ? 'Applying Schedule...' : 'Apply Schedule'}
                </button>
              </div>
            </form>

            {/* Schedule Parsing Feedback */}
            {nlpResult && (
              <div className="mt-4 p-3.5 rounded-xl bg-brand-50/70 border border-brand-100 text-xs text-brand-900 animate-fade-in">
                <span className="font-bold block mb-1">Schedule Preferences Detected:</span>
                <div className="space-y-1 text-[11px] text-brand-800">
                  <div>• Active Days: {nlpResult.constraints?.days?.join(', ') || 'Weekdays'}</div>
                  <div>• Daily Window: {nlpResult.constraints?.start_time} to {nlpResult.constraints?.end_time}</div>
                  {nlpResult.constraints?.avoid_days?.length > 0 && (
                    <div>• Blackout Days: {nlpResult.constraints?.avoid_days?.join(', ')}</div>
                  )}
                  <div>• Generated: {nlpResult.windows?.length || 0} time window slots</div>
                </div>
              </div>
            )}
          </div>

          {/* Quick Manual Add Form */}
          <div className="card p-5 bg-white border border-sky-100 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-1.5">
              <Plus className="h-4 w-4 text-brand-600" />
              Add Specific Date Window
            </h3>

            <form onSubmit={handleAddWindow} className="space-y-3 text-xs">
              <div>
                <label className="label text-[10px]">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label text-[10px]">Start Time</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="input text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="label text-[10px]">End Time</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="input text-xs"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="label text-[10px]">Type</label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="input text-xs cursor-pointer"
                >
                  <option value="PREFERRED">Preferred Slot (Higher ranking score)</option>
                  <option value="AVAILABLE">Available Slot</option>
                  <option value="UNAVAILABLE">Unavailable / Blackout (Hard block)</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="btn-secondary w-full text-xs py-2 mt-2"
              >
                {saving ? 'Adding...' : 'Add Window'}
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Declared Windows Table (7 Cols) */}
        <div className="md:col-span-6">
          <div className="card p-5 bg-white border border-sky-100 shadow-sm h-full flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-sky-50 mb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Declared Free Windows</h3>
                <p className="text-[11px] text-slate-500">
                  Active slots considered by the scheduler
                </p>
              </div>
              <span className="chip chip-blue">{displayedWindows.length} slots active</span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 pr-1 max-h-[500px]">
              {displayedWindows.length === 0 ? (
                <div className="text-center py-16 text-xs text-slate-400">
                  No declared availability windows yet. Add some on the left!
                </div>
              ) : (
                displayedWindows.map((w) => {
                  // Render in the candidate's chosen zone, not the browser's.
                  const start = DateTime.fromISO(w.startUtc, { zone: user?.timezone || 'UTC' });
                  const end = DateTime.fromISO(w.endUtc, { zone: user?.timezone || 'UTC' });
                  const isPreferred = w.kind === 'PREFERRED';
                  const isBlackout = w.kind === 'UNAVAILABLE';

                  return (
                    <div
                      key={w.id}
                      className="py-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">
                            {start.toFormat('ccc, LLL dd')}
                          </span>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                              isPreferred
                                ? 'bg-purple-100 text-purple-800 border-purple-200'
                                : isBlackout
                                ? 'bg-rose-100 text-rose-800 border-rose-200'
                                : 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            }`}
                          >
                            {w.kind}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-500 font-medium">
                          {start.toFormat('hh:mm a')} – {end.toFormat('hh:mm a')} ({user?.timezone || 'Local'})
                        </span>
                      </div>

                      <button
                        onClick={() => handleDeleteWindow(w.id)}
                        className="text-slate-400 hover:text-rose-600 p-1 transition"
                        title="Remove slot"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
