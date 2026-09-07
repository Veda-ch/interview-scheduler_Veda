/**
 * CalendarProvider abstraction.
 *
 * Two implementations ship: MockCalendarProvider (a real, queryable in-database
 * calendar used in demo mode) and GoogleCalendarProvider (OAuth 2.0 + REST).
 * The scheduler never talks to either directly - it goes through this interface,
 * so a calendar outage degrades to "event not synced" rather than "cannot
 * schedule interviews".
 *
 * OAuth secrets come only from the environment. Tokens are encrypted at rest.
 */
import crypto from 'node:crypto';
import config from '../config/env.js';
import logger from '../lib/logger.js';
import prisma from '../lib/prisma.js';
import { encryptSecret, decryptSecret } from '../lib/crypto.js';

class CalendarProvider {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async getBusyWindows(_userId, _from, _to) {
    return [];
  }
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async createEvent(_event) {
    throw new Error('not implemented');
  }
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async updateEvent(_externalId, _event) {
    throw new Error('not implemented');
  }
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async cancelEvent(_externalId) {
    throw new Error('not implemented');
  }
}

/**
 * The demo calendar. Not a stub: busy windows come from the real Booking table,
 * so "check the participants' calendars" is genuinely answered - just by our own
 * store instead of Google's.
 */
export class MockCalendarProvider extends CalendarProvider {
  name = 'MOCK';

  async getBusyWindows(userId, from, to) {
    const rows = await prisma.booking.findMany({
      where: { userId, startUtc: { lt: to }, endUtc: { gt: from } },
      orderBy: { startUtc: 'asc' },
    });
    return rows.map((b) => ({ start: b.startUtc, end: b.endUtc, source: 'internal', kind: b.kind }));
  }

  async createEvent(event) {
    return {
      provider: this.name,
      externalId: `mock-evt-${crypto.randomBytes(8).toString('hex')}`,
      htmlLink: null,
      status: 'CONFIRMED',
      attendees: event.attendees?.map((a) => a.email) ?? [],
    };
  }

  async updateEvent(externalId, _event) {
    return { provider: this.name, externalId, status: 'CONFIRMED' };
  }

  async cancelEvent(externalId) {
    return { provider: this.name, externalId, status: 'CANCELLED' };
  }
}

export class GoogleCalendarProvider extends CalendarProvider {
  name = 'GOOGLE';
  static API = 'https://www.googleapis.com/calendar/v3';
  static TOKEN_URL = 'https://oauth2.googleapis.com/token';

  /** Exchange an authorisation code for tokens (server-side only). */
  static async exchangeCode(code) {
    const res = await fetch(GoogleCalendarProvider.TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: config.google.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  static authUrl(state) {
    const params = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: config.google.redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent select_account',
      scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /** Fetch (refreshing if needed) a usable access token for a user. */
  async #accessToken(userId) {
    const link = await prisma.calendarConnection.findUnique({
      where: { userId_provider: { userId, provider: 'GOOGLE' } },
    });
    if (!link) throw new Error('User has not connected a Google Calendar');

    if (link.expiresAt && link.expiresAt > new Date(Date.now() + 60_000)) {
      return decryptSecret(link.accessToken);
    }

    const refresh = decryptSecret(link.refreshToken);
    if (!refresh) throw new Error('Google Calendar connection expired; reconnect required');

    const res = await fetch(GoogleCalendarProvider.TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        refresh_token: refresh,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      await prisma.calendarConnection.update({ where: { id: link.id }, data: { status: 'EXPIRED' } });
      throw new Error('Google token refresh failed; reconnect required');
    }
    const data = await res.json();
    await prisma.calendarConnection.update({
      where: { id: link.id },
      data: {
        accessToken: encryptSecret(data.access_token),
        expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
        status: 'CONNECTED',
      },
    });
    return data.access_token;
  }

  async #call(userId, path, options = {}) {
    const token = await this.#accessToken(userId);
    const res = await fetch(`${GoogleCalendarProvider.API}${path}`, {
      ...options,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers || {}) },
    });
    if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? {} : res.json();
  }

  async getBusyWindows(userId, from, to) {
    const data = await this.#call(userId, '/freeBusy', {
      method: 'POST',
      body: JSON.stringify({
        timeMin: new Date(from).toISOString(),
        timeMax: new Date(to).toISOString(),
        items: [{ id: 'primary' }],
      }),
    });
    const busy = data.calendars?.primary?.busy ?? [];
    return busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end), source: 'google' }));
  }

  async createEvent(event) {
    const data = await this.#call(event.organizerUserId, '/calendars/primary/events?sendUpdates=all&conferenceDataVersion=1', {
      method: 'POST',
      body: JSON.stringify({
        summary: event.title,
        description: event.description,
        start: { dateTime: new Date(event.startUtc).toISOString() },
        end: { dateTime: new Date(event.endUtc).toISOString() },
        attendees: event.attendees.map((a) => ({ email: a.email, displayName: a.name })),
        reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }, { method: 'popup', minutes: 10 }] },
        ...(event.requestConference
          ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } }
          : {}),
      }),
    });
    return {
      provider: this.name,
      externalId: data.id,
      htmlLink: data.htmlLink,
      hangoutLink: data.hangoutLink ?? null,
      status: 'CONFIRMED',
    };
  }

  async updateEvent(externalId, event) {
    const data = await this.#call(event.organizerUserId, `/calendars/primary/events/${externalId}?sendUpdates=all`, {
      method: 'PATCH',
      body: JSON.stringify({
        summary: event.title,
        description: event.description,
        start: { dateTime: new Date(event.startUtc).toISOString() },
        end: { dateTime: new Date(event.endUtc).toISOString() },
        ...(event.attendees ? { attendees: event.attendees.map((a) => ({ email: a.email })) } : {}),
      }),
    });
    return { provider: this.name, externalId: data.id, htmlLink: data.htmlLink, status: 'CONFIRMED' };
  }

  async cancelEvent(externalId, { organizerUserId }) {
    await this.#call(organizerUserId, `/calendars/primary/events/${externalId}?sendUpdates=all`, { method: 'DELETE' });
    return { provider: this.name, externalId, status: 'CANCELLED' };
  }
}

let instance = null;

export function getCalendarProvider() {
  if (instance) return instance;
  if (config.providers.calendar === 'google') {
    if (!config.google.configured) {
      logger.warn('CALENDAR_PROVIDER=google without credentials - using the mock calendar');
      instance = new MockCalendarProvider();
    } else {
      instance = new GoogleCalendarProvider();
    }
  } else {
    instance = new MockCalendarProvider();
  }
  logger.info(`Calendar provider: ${instance.name}`);
  return instance;
}

/**
 * Create an event without ever failing the caller. A calendar outage produces a
 * CalendarEventRecord in SYNC_FAILED state, which the Control Tower monitor then
 * picks up and retries - the interview itself remains valid.
 */
export async function createEventSafely(event) {
  const provider = getCalendarProvider();
  try {
    const result = await provider.createEvent(event);
    return { ok: true, result };
  } catch (err) {
    logger.error('Calendar event creation failed', { error: err.message, interviewId: event.interviewId });
    return { ok: false, error: err.message, result: { provider: provider.name, externalId: `failed-${Date.now()}`, status: 'SYNC_FAILED' } };
  }
}

export async function cancelEventSafely(externalId, ctx) {
  const provider = getCalendarProvider();
  try {
    return { ok: true, result: await provider.cancelEvent(externalId, ctx) };
  } catch (err) {
    logger.warn('Calendar event cancellation failed', { error: err.message, externalId });
    return { ok: false, error: err.message };
  }
}

export const resetCalendarProvider = () => {
  instance = null;
};
