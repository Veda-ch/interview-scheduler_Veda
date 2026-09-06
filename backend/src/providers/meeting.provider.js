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

/**
 * Google Meet links are created as a conference *inside* a Calendar event, so
 * this provider defers to the calendar provider rather than owning a room API.
 */
export class GoogleMeetProvider extends MeetingProvider {
  name = 'GOOGLE_MEET';

  constructor(calendarProvider) {
    super();
    this.calendarProvider = calendarProvider;
  }

  async createMeeting(ctx) {
    if (!config.google.configured) {
      throw new Error('Google Meet requires GOOGLE_CLIENT_ID/SECRET; falling back');
    }
    // The calendar event creation path requests a hangoutLink; if it is not
    // there yet the caller retries after the event exists.
    return {
      provider: this.name,
      externalId: `pending-${ctx.interviewId}`,
      joinUrl: '',
      deferredToCalendar: true,
    };
  }
}

let instance = null;

export function getMeetingProvider() {
  if (instance) return instance;
  switch (config.providers.meeting) {
    case 'mock':
      instance = new MockMeetingProvider();
      break;
    case 'google_meet':
      if (!config.google.configured) {
        logger.warn('MEETING_PROVIDER=google_meet without Google credentials - using Jitsi');
        instance = new JitsiMeetingProvider();
      } else {
        instance = new GoogleMeetProvider();
      }
      break;
    case 'jitsi':
    default:
      instance = new JitsiMeetingProvider();
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
