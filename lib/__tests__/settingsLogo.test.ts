import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readBranding, updateBranding } = vi.hoisted(() => ({
  readBranding: vi.fn(),
  updateBranding: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: readBranding }) }),
    }),
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({
      update: () => ({ eq: () => ({ select: () => ({ maybeSingle: updateBranding }) }) }),
    }),
  }),
}));

/** A fresh module, so each test starts with an empty cache. */
async function freshSettings() {
  vi.resetModules();
  return import('@/lib/settings');
}

beforeEach(() => {
  readBranding.mockReset();
  updateBranding.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getLogoDataUrl caching', () => {
  it('reads once and reuses it for the rest of the minute', async () => {
    vi.useFakeTimers();
    readBranding.mockResolvedValue({ data: { logo_data_url: 'data:image/png;base64,AAA' }, error: null });
    const { getLogoDataUrl } = await freshSettings();

    expect(await getLogoDataUrl()).toBe('data:image/png;base64,AAA');
    expect(await getLogoDataUrl()).toBe('data:image/png;base64,AAA');
    expect(await getLogoDataUrl()).toBe('data:image/png;base64,AAA');
    expect(readBranding).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(await getLogoDataUrl()).toBe('data:image/png;base64,AAA');
    expect(readBranding).toHaveBeenCalledTimes(2);
  });

  it('gives concurrent callers on a cold cache one shared read', async () => {
    // The small version of the pile-up the cache exists to prevent: without
    // holding the promise rather than the value, every request that arrives
    // before the first read resolves starts its own.
    let release: (v: unknown) => void = () => {};
    readBranding.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const { getLogoDataUrl } = await freshSettings();

    const all = Promise.all([getLogoDataUrl(), getLogoDataUrl(), getLogoDataUrl()]);
    release({ data: { logo_data_url: 'shared' }, error: null });

    expect(await all).toEqual(['shared', 'shared', 'shared']);
    expect(readBranding).toHaveBeenCalledTimes(1);
  });

  it('does not hold on to a failed read', async () => {
    readBranding.mockResolvedValueOnce({ data: null, error: { message: 'connection reset' } });
    readBranding.mockResolvedValueOnce({ data: { logo_data_url: 'recovered' }, error: null });
    const { getLogoDataUrl } = await freshSettings();

    await expect(getLogoDataUrl()).rejects.toThrow();

    // One blip during a database restart must not blank the logo for a minute.
    expect(await getLogoDataUrl()).toBe('recovered');
    expect(readBranding).toHaveBeenCalledTimes(2);
  });

  it('shows an admin the logo they just uploaded, without another read', async () => {
    readBranding.mockResolvedValue({ data: { logo_data_url: 'old' }, error: null });
    updateBranding.mockResolvedValue({ data: { logo_data_url: 'new' }, error: null });
    const { getLogoDataUrl, saveLogoDataUrl } = await freshSettings();

    expect(await getLogoDataUrl()).toBe('old');
    expect(await saveLogoDataUrl('new')).toBe('new');
    expect(await getLogoDataUrl()).toBe('new');
    expect(readBranding).toHaveBeenCalledTimes(1);
  });
});
