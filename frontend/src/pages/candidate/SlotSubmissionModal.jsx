import React, { useState } from 'react';
import { api } from '../../lib/api.js';
import { X, Calendar, Clock, CheckCircle2, AlertCircle, Plus, Trash2, Sparkles } from 'lucide-react';
import { DateTime } from 'luxon';

export default function SlotSubmissionModal({ isOpen, request, onClose, onSuccess }) {
  if (!isOpen || !request) return null;

  const candidateTz = request.candidate?.timezone || 'Asia/Kolkata';
  const earliest = DateTime.fromISO(request.earliestUtc, { zone: candidateTz });
  const latest = DateTime.fromISO(request.latestUtc, { zone: candidateTz });

  // Default initial slots based on earliest date window
  const [slots, setSlots] = useState([
    {
      date: earliest.toISODate(),
      startTime: '10:00',
      durationMinutes: request.durationMinutes || 60,
    },
    {
      date: earliest.plus({ days: 1 }).toISODate(),
      startTime: '14:00',
      durationMinutes: request.durationMinutes || 60,
    },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function addSlot() {
    if (slots.length >= 4) return;
    const lastSlot = slots[slots.length - 1];
    const nextDate = lastSlot
      ? DateTime.fromISO(lastSlot.date).plus({ days: 1 }).toISODate()
      : earliest.toISODate();
    setSlots([
      ...slots,
      {
        date: nextDate,
        startTime: '11:00',
        durationMinutes: request.durationMinutes || 60,
      },
    ]);
  }

  function removeSlot(index) {
    if (slots.length <= 1) return;
    setSlots(slots.filter((_, idx) => idx !== index));
  }

  function updateSlot(index, field, value) {
    const updated = [...slots];
    updated[index][field] = value;
    setSlots(updated);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      // Convert selected date + time strings into UTC ISO strings
      const payloadSlots = slots.map((s) => {
        const startDt = DateTime.fromISO(`${s.date}T${s.startTime}`, { zone: candidateTz });
        const endDt = startDt.plus({ minutes: Number(s.durationMinutes) });
        return {
          startUtc: startDt.toUTC().toISO(),
          endUtc: endDt.toUTC().toISO(),
        };
      });

      await api.post(`/interview-requests/${request.id}/candidate-slots`, { slots: payloadSlots });
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to submit candidate slots:', err);
      setError(err.message || 'Failed to submit time slots. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden border border-sky-100 flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-sky-100 bg-sky-50/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand-100 text-brand-700 rounded-xl">
              <Calendar className="h-6 w-6" />
            </div>
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-brand-700 bg-white px-2 py-0.5 rounded border border-sky-200">
                {request.interviewType} • {request.durationMinutes} Min
              </span>
              <h2 className="text-lg font-bold text-slate-900 mt-1">{request.roundName}</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Date Window Banner */}
        <div className="px-6 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-2 text-xs text-amber-900 font-semibold">
          <Clock className="h-4 w-4 text-amber-700 shrink-0" />
          <span>
            Recruiter Date Window:{' '}
            <strong className="text-slate-900">{earliest.toFormat('ccc, LLL dd')}</strong> –{' '}
            <strong className="text-slate-900">{latest.toFormat('ccc, LLL dd, yyyy')}</strong>
          </span>
        </div>

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          <p className="text-xs text-slate-600 leading-relaxed">
            Please select up to 3 convenient time slots within the recruiter's date window when you will be available for this round.
          </p>

          {/* Slots List */}
          <div className="space-y-3">
            {slots.map((slot, index) => (
              <div
                key={index}
                className="p-3.5 rounded-xl border border-sky-100 bg-sky-50/40 flex items-center justify-between gap-3"
              >
                <div className="grid grid-cols-2 gap-3 flex-1">
                  <div>
                    <label className="label text-[11px] mb-1">Date</label>
                    <input
                      type="date"
                      min={earliest.toISODate()}
                      max={latest.toISODate()}
                      value={slot.date}
                      onChange={(e) => updateSlot(index, 'date', e.target.value)}
                      className="input py-1 text-xs"
                      required
                    />
                  </div>
                  <div>
                    <label className="label text-[11px] mb-1">Start Time ({candidateTz})</label>
                    <input
                      type="time"
                      value={slot.startTime}
                      onChange={(e) => updateSlot(index, 'startTime', e.target.value)}
                      className="input py-1 text-xs"
                      required
                    />
                  </div>
                </div>

                {slots.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSlot(index)}
                    className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition self-end mb-0.5"
                    title="Remove slot"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {slots.length < 4 && (
            <button
              type="button"
              onClick={addSlot}
              className="btn-secondary w-full text-xs py-2 flex items-center justify-center gap-2 border-dashed border-sky-300 text-brand-700 bg-sky-50/50 hover:bg-sky-100/60"
            >
              <Plus className="h-4 w-4" /> Add Another Preferred Slot
            </button>
          )}

          {/* Action Buttons */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="btn-ghost text-xs py-2 px-4">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary text-xs py-2.5 px-5 flex items-center gap-2 shadow-md shadow-brand-500/20"
            >
              {submitting ? (
                <span>Submitting Slots...</span>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Submit Time Slots to Recruiter
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
