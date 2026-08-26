import { describe, expect, it, vi } from 'vitest';

const createDelivery = vi.fn();

vi.mock('@/lib/config', () => ({ missingEnv: () => [] }));
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => ({
    id: 'merchant-1',
    username: 'obra',
    companyName: 'Obra Chop Bar',
    role: 'merchant',
    active: true,
  }),
}));
vi.mock('@/lib/rateLimit', () => ({ enforceRateLimit: vi.fn() }));
// The missing-key path never reaches the idempotency store. Mock the external
// admin-client boundary so the real header parser and route code remain under test.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/deliveries', () => ({
  DeliveryError: class DeliveryError extends Error {},
  createDelivery,
  listDeliveriesFor: vi.fn(),
}));

const { POST } = await import('@/app/api/deliveries/route');

describe('POST /api/deliveries — idempotency backstop', () => {
  it('rejects a request without Idempotency-Key before delivery validation or creation', async () => {
    const response = await POST(
      new Request('http://localhost/api/deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Idempotency-Key header is required.' });
    expect(createDelivery).not.toHaveBeenCalled();
  });
});
