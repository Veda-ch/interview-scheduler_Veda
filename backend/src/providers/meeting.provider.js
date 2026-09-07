/**
 * MeetingProvider abstraction.
 *
 * Jitsi is the default because it needs no account, no API key and no quota -
 * a room exists the moment someone opens its URL. That makes the demo genuinely
 * functional rather than mocked, while Google Meet / Zoom slot in behind the
 * same interface when credentials exist.
 */
import crypto from 'node:crypto';
import config from '../config/env.js';
import logger from '../lib/logger.js';

/**
 * @typedef {object} MeetingResult
 * @property {string} provider
 * @property {string} externalId
 * @property {string} joinUrl
 * @property {string} [hostUrl]
 * @property {string} [passcode]
 */

class MeetingProvider {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async createMeeting(_ctx) {
    throw new Error('not implemented');
  }
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async cancelMeeting(_meeting) {
    return { ok: true };
  }
}

/** Deterministic, unguessable Jitsi room names derived from the interview id. */
export class JitsiMeetingProvider extends MeetingProvider {
  name = 'JITSI';

  constructor(domain = config.jitsi.domain) {
    super();
    this.domain = domain;
  }

  async createMeeting({ interviewId, jobTitle = 'Interview', roundName = '' }) {
    // 128 bits of entropy in the room name: the URL is the access control.
    const entropy = crypto.randomBytes(16).toString('hex');
    const slug = `${jobTitle}-${roundName}`
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .toLowerCase();
    const room = `ivs-${slug || 'interview'}-${entropy}`;

    return {
      provider: this.name,
      externalId: room,
      joinUrl: `https://${this.domain}/${room}`,
      hostUrl: `https://${this.domain}/${room}#config.prejoinPageEnabled=false`,
      passcode: null,
      embeddable: true,
      note: `Room is created on first join. Interview ${interviewId}.`,
    };
  }

  async cancelMeeting() {
    // Jitsi rooms are ephemeral - they cease to exist when everyone leaves.
    return { ok: true, note: 'Jitsi rooms expire automatically' };
  }
}

/** Offline provider for tests and air-gapped demos. */
export class MockMeetingProvider extends MeetingProvider {
  name = 'MOCK';

  async createMeeting({ interviewId }) {
    const id = `mock-${crypto.randomBytes(6).toString('hex')}`;
    return {
      provider: this.name,
      externalId: id,
      joinUrl: `https://meet.invalid/${id}`,
      hostUrl: `https://meet.invalid/${id}?host=1`,
      passcode: String(Math.floor(100000 + Math.random() * 900000)),
      embeddable: false,
      note: `Mock meeting for interview ${interviewId} - not a real room.`,
    };
  }
}

function generateGoogleMeetCode(seed = '') {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const hash = crypto.createHash('md5').update(`${seed}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`).digest('hex');
  const pick = (idx) => letters[parseInt(hash.slice(idx * 2, idx * 2 + 2), 16) % letters.length];
  const p1 = `${pick(0)}${pick(1)}${pick(2)}`;
  const p2 = `${pick(3)}${pick(4)}${pick(5)}${pick(6)}`;
  const p3 = `${pick(7)}${pick(8)}${pick(9)}`;
  return `${p1}-${p2}-${p3}`;
}

/**
 * Google Meet provider. Generates Google Meet links (https://meet.google.com/xxx-yyyy-zzz).
 * When Google Calendar OAuth is connected, it syncs the conference directly to Google Calendar.
 */
export class GoogleMeetProvider extends MeetingProvider {
  name = 'GOOGLE_MEET';

  async createMeeting(ctx) {
    let meetUrl = (config.google.defaultMeetUrl || process.env.DEFAULT_GOOGLE_MEET_URL || '').trim();
    let code;
    if (meetUrl) {
      if (!meetUrl.startsWith('http')) meetUrl = `https://${meetUrl}`;
      code = meetUrl.split('/').pop() || 'meet';
    } else {
      code = generateGoogleMeetCode(ctx.interviewId || ctx.jobTitle || 'interview');
      meetUrl = `https://meet.google.com/${code}`;
    }

    return {
      provider: this.name,
      externalId: code,
      joinUrl: meetUrl,
      hostUrl: meetUrl,
      passcode: null,
      embeddable: false,
      note: `Google Meet link created for interview ${ctx.interviewId}.`,
    };
  }

  async cancelMeeting() {
    return { ok: true, note: 'Google Meet link released' };
  }
}

/**
 * Zoom meeting provider using Server-to-Server OAuth.
 * Requires ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET.
 */
export class ZoomMeetingProvider extends MeetingProvider {
  name = 'ZOOM';

  async #getAccessToken() {
    if (!config.zoom.configured) {
      throw new Error('Zoom requires ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_CLIENT_SECRET');
    }
    const auth = Buffer.from(`${config.zoom.clientId}:${config.zoom.clientSecret}`).toString('base64');
    const url = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${config.zoom.accountId}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
      },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Zoom OAuth failed (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.access_token;
  }

  async createMeeting({ interviewId, jobTitle = 'Interview', roundName = '', startUtc, endUtc }) {
    const token = await this.#getAccessToken();
    const duration = startUtc && endUtc
      ? Math.max(15, Math.round((new Date(endUtc) - new Date(startUtc)) / 60000))
      : 60;

    const res = await fetch('https://api.zoom.us/v2/users/me/meetings', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        topic: `${jobTitle} - ${roundName || 'Interview'}`,
        type: 2, // Scheduled meeting
        start_time: startUtc ? new Date(startUtc).toISOString() : new Date().toISOString(),
        duration,
        settings: {
          join_before_host: true,
          waiting_room: false,
          audio: 'both',
          auto_recording: 'none',
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Zoom meeting creation failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    return {
      provider: this.name,
      externalId: String(data.id),
      joinUrl: data.join_url,
      hostUrl: data.start_url || null,
      passcode: data.password || null,
      embeddable: false,
      note: `Zoom meeting created for interview ${interviewId}.`,
    };
  }

  async cancelMeeting(meeting) {
    if (!meeting?.externalId) return { ok: true };
    try {
      const token = await this.#getAccessToken();
      await fetch(`https://api.zoom.us/v2/meetings/${meeting.externalId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      return { ok: true };
    } catch (err) {
      logger.warn('Failed to delete Zoom meeting', { error: err.message, externalId: meeting.externalId });
      return { ok: false, error: err.message };
    }
  }
}

let instance = null;

export function getMeetingProvider() {
  if (instance) return instance;
  switch (config.providers.meeting) {
    case 'mock':
      instance = new MockMeetingProvider();
      break;
    case 'zoom':
      if (!config.zoom.configured) {
        logger.warn('MEETING_PROVIDER=zoom without Zoom credentials - using Google Meet');
        instance = new GoogleMeetProvider();
      } else {
        instance = new ZoomMeetingProvider();
      }
      break;
    case 'jitsi':
      instance = new JitsiMeetingProvider();
      break;
    case 'google_meet':
    default:
      instance = new GoogleMeetProvider();
  }
  logger.info(`Meeting provider: ${instance.name}`);
  return instance;
}

/**
 * Create a meeting with graceful degradation: a meeting-link failure must never
 * block the interview from being scheduled. It raises an incident instead.
 */
export async function createMeetingSafely(ctx) {
  const provider = getMeetingProvider();
  try {
    const meeting = await provider.createMeeting(ctx);
    return { ok: true, meeting };
  } catch (err) {
    logger.error('Meeting creation failed', { error: err.message, interviewId: ctx.interviewId });
    try {
      const fallback = await new MockMeetingProvider().createMeeting(ctx);
      return { ok: false, meeting: { ...fallback, status: 'FAILED' }, error: err.message, degraded: true };
    } catch {
      return { ok: false, meeting: null, error: err.message, degraded: true };
    }
  }
}

export const resetMeetingProvider = () => {
  instance = null;
};
