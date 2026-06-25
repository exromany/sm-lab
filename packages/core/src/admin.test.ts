import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { registerAdminRoutes, setShutdownHandler } from './admin';

afterEach(() => vi.useRealTimers());

describe('registerAdminRoutes', () => {
  it('GET /admin/status returns the base envelope merged with getStatus extras', async () => {
    const app = new Hono();
    registerAdminRoutes(app, {
      version: '9.9.9',
      getStatus: () => ({ pins: { total: 2 } }),
    });

    const res = await app.request('/admin/status');
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ ok: true, version: '9.9.9', pins: { total: 2 } });
    expect(typeof json.startedAt).toBe('string');
    expect(typeof json.uptimeSeconds).toBe('number');
  });

  it('works with no getStatus (base envelope only)', async () => {
    const app = new Hono();
    registerAdminRoutes(app, { version: '1.0.0' });
    const json = (await (await app.request('/admin/status')).json()) as Record<string, unknown>;
    expect(json).toMatchObject({ ok: true, version: '1.0.0' });
  });

  it('POST /admin/shutdown acks and fires the registered handler (after 50ms)', async () => {
    vi.useFakeTimers();
    const app = new Hono();
    registerAdminRoutes(app, { version: '1.0.0' });
    let fired = false;
    setShutdownHandler(() => {
      fired = true;
    });

    const res = await app.request('/admin/shutdown', { method: 'POST' });
    expect(((await res.json()) as { message: string }).message).toBe('shutting down');
    expect(fired).toBe(false); // deferred
    vi.advanceTimersByTime(50);
    expect(fired).toBe(true);
  });
});
