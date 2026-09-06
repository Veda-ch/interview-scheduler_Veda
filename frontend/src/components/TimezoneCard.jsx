import React, { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Globe, CheckCircle2, AlertCircle } from 'lucide-react';
import { DateTime } from 'luxon';

/**
 * Timezone selector for whoever is signed in.
 *
 * Every availability window is entered in the viewer's zone and stored in UTC,
 * so changing this changes how existing windows read - the preview line below
 * the selector makes that consequence visible before they save.
 */
export default function TimezoneCard({ note }) {
  const { user, updateAccount } = useAuth();
  const [zones, setZones] = useState([]);
  const [value, setValue] = useState(user?.timezone || 'UTC');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get('/users/timezones')
      .then((list) => setZones(list || []))
      .catch(() => setZones([]));
  }, []);

  useEffect(() => {
    setValue(user?.timezone || 'UTC');
  }, [user?.timezone]);

  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dirty = value !== (user?.timezone || 'UTC');

  // The catalog may not include the browser's zone - keep it selectable anyway.
  const options = [...new Set([...(zones || []), detected, user?.timezone].filter(Boolean))].sort();

  async function save(next = value) {
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      await updateAccount({ timezone: next });
      setMsg(`Timezone set to ${next}. All times now display in this zone.`);
      setTimeout(() => setMsg(null), 4000);
    } catch (err) {
      setError(err.message || 'Could not save your timezone');
      setValue(user?.timezone || 'UTC');
    } finally {
      setSaving(false);
    }
  }

  const now = DateTime.now().setZone(value);

  return (
    <div className="card p-5 bg-white border border-sky-100 shadow-sm">
      <div className="flex items-start gap-2 mb-3">
        <div className="p-2 rounded-lg bg-sky-100 text-sky-700">
          <Globe className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900">My Timezone</h3>
          <p className="text-[11px] text-slate-500">
            {note || 'Every time you enter or see is interpreted in this zone.'}
          </p>
        </div>
      </div>

      {msg && (
        <div className="mb-3 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-800 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {msg}
        </div>
      )}
      {error && (
        <div className="mb-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] font-semibold text-rose-800 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      <label className="label text-[10px]">IANA Timezone</label>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="input text-xs cursor-pointer"
        disabled={saving}
        title="Select your timezone"
      >
        {options.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>

      <p className="text-[11px] text-slate-500 mt-2">
        Current time there: <strong className="text-slate-800">{now.toFormat('ccc dd LLL, HH:mm')}</strong>{' '}
        ({now.toFormat('ZZZZ')})
      </p>

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => save()}
          disabled={!dirty || saving}
          className="btn-primary text-xs py-2 px-4 disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Save Timezone'}
        </button>
        {detected && detected !== value && (
          <button
            onClick={() => { setValue(detected); save(detected); }}
            disabled={saving}
            className="btn-secondary text-xs py-2 px-3"
            title={`Use the timezone your browser reports (${detected})`}
          >
            Use {detected}
          </button>
        )}
      </div>
    </div>
  );
}
