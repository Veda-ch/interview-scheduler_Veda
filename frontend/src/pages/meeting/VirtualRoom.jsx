import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import {
  Video,
  ExternalLink,
  Users,
  Clock,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Copy,
  Sparkles,
} from 'lucide-react';
import { DateTime } from 'luxon';

export default function VirtualRoom() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [interview, setInterview] = useState(null);
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadMeeting() {
      setLoading(true);
      try {
        const iv = await api.get(`/interviews/${id}`);
        setInterview(iv);
        if (iv.meeting) {
          setMeeting(iv.meeting);
        } else {
          // If no meeting exists yet, try joining room endpoint
          const joinInfo = await api.get(`/meetings/${id}`).catch(() => null);
          setMeeting(joinInfo);
        }
      } catch (err) {
        console.error('Failed to load meeting room:', err);
        setError(err.message || 'Room not available yet');
      } finally {
        setLoading(false);
      }
    }
    loadMeeting();
  }, [id]);

  function copyJoinUrl() {
    if (meeting?.joinUrl) {
      navigator.clipboard.writeText(meeting.joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const isJitsi =
    meeting?.provider === 'JITSI' ||
    (meeting?.joinUrl && meeting.joinUrl.includes('jit.si'));

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Top Bar in Meeting Room */}
      <header className="h-16 px-6 bg-slate-950/80 border-b border-white/10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
            title="Leave Room"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              {interview?.round?.name || 'Interview Session'}
            </h2>
            <span className="text-xs text-slate-400">
              {interview?.candidate?.name || 'Candidate'} •{' '}
              {interview?.job?.title || 'Engineer'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {meeting?.joinUrl && (
            <button
              onClick={copyJoinUrl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-slate-200 transition"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? 'Link Copied!' : 'Copy Join Link'}
            </button>
          )}
          {meeting?.joinUrl && (
            <a
              href={meeting.joinUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-xs font-semibold text-white transition shadow-sm"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in External Tab
            </a>
          )}
        </div>
      </header>

      {/* Main Video Frame / Launcher Canvas */}
      <main className="flex-1 relative flex items-center justify-center p-4 bg-slate-950">
        {loading && (
          <div className="text-center">
            <div className="h-12 w-12 rounded-full border-4 border-brand-500 border-t-transparent animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400 font-medium">Connecting to virtual room...</p>
          </div>
        )}

        {!loading && error && (
          <div className="max-w-md text-center p-8 rounded-2xl bg-white/5 border border-white/10">
            <AlertCircle className="h-10 w-10 text-amber-400 mx-auto mb-3" />
            <h3 className="text-base font-bold text-white">Meeting Room Standby</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">{error}</p>
            <button
              onClick={() => navigate(-1)}
              className="btn-ghost text-xs py-2 px-4 mt-4 text-white border-white/20"
            >
              Back to Dashboard
            </button>
          </div>
        )}

        {!loading && !error && meeting && (
          <div className="w-full h-full max-w-6xl max-h-[85vh] rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-slate-900 relative">
            {isJitsi ? (
              <iframe
                src={`${meeting.joinUrl}#config.prejoinPageEnabled=false&interfaceConfig.TOOLBAR_BUTTONS=['microphone','camera','closedcaptions','desktop','embedmeeting','fullscreen','fodeviceselection','hangup','profile','chat','recording','livestreaming','etherpad','sharedvideo','settings','raisehand','videoquality','filmstrip','invite','feedback','stats','shortcuts','tileview','videobackgroundblur','download','help','mute-everyone']`}
                allow="camera; microphone; fullscreen; display-capture; autoplay"
                className="w-full h-full border-0"
                title="Interview Virtual Room"
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <div className="h-16 w-16 rounded-3xl bg-brand-600/20 text-brand-400 flex items-center justify-center mb-4">
                  <Video className="h-8 w-8" />
                </div>
                <h3 className="text-lg font-bold text-white">
                  {meeting.provider || 'Virtual'} Conference Ready
                </h3>
                <p className="text-xs text-slate-400 max-w-md mt-1 mb-6">
                  Click below to open your secure video call link with the panel.
                </p>
                <a
                  href={meeting.joinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary py-2.5 px-6 text-sm flex items-center gap-2"
                >
                  Launch {meeting.provider || 'Meeting'} Call <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
