import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewDeliveryForm } from '@/components/delivery/NewDeliveryForm';
import type { DeliveryOptions, PricingParams, SessionUser } from '@/lib/types';

const toast = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => toast,
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
  errMessage: (e: unknown) => String(e),
}));

let mapsReady = false;

vi.mock('@/components/MapsProvider', () => ({
  useMaps: () => ({ ready: mapsReady, configured: true }),
}));

const user: SessionUser = {
  id: 'u1',
  username: 'ama',
  role: 'merchant',
  companyName: 'Somo Retail',
  phone: '0200000000',
};

const params: PricingParams = {
  base: 10,
  rate: 6,
  perMin: 0,
  minFare: 25,
  bookingFee: 0,
  platformFee: 0,
  opsPhone: '0200000000',
  surcharges: [],
};

const options: DeliveryOptions = { itemCategories: [] };

/** Every Autocomplete the form constructs, and the field it was given. */
const bound: { el: HTMLInputElement; instance: object }[] = [];
/** Instances the form has since unbound. */
const cleared: object[] = [];

class FakeAutocomplete {
  constructor(el: HTMLInputElement) {
    bound.push({ el, instance: this });
  }
  addListener() {}
}

/**
 * The SDK as it looks once Places is genuinely usable — the state MapsProvider
 * now waits for before reporting ready.
 */
function stubMaps() {
  mapsReady = true;
  (window as unknown as { google: unknown }).google = {
    maps: {
      places: { Autocomplete: FakeAutocomplete },
      event: { clearInstanceListeners: (i: object) => cleared.push(i) },
      Geocoder: class {
        geocode(_req: unknown, cb: (r: unknown, s: string) => void) {
          cb([{ formatted_address: '48 Oxford St, Accra, Ghana', types: ['street_address'] }], 'OK');
        }
      },
    },
  };
}

function grantPosition() {
  Object.defineProperty(navigator, 'geolocation', {
    value: {
      getCurrentPosition: vi.fn((ok: PositionCallback) =>
        ok({ coords: { latitude: 5.5563, longitude: -0.1826 } } as GeolocationPosition)
      ),
    },
    configurable: true,
  });
}

const pickupInput = () =>
  screen.getByPlaceholderText('e.g. Osu, Oxford Street') as HTMLInputElement;
const dropoffInput = () =>
  screen.getByPlaceholderText('e.g. East Legon, American House') as HTMLInputElement;
const locateButton = () => screen.getByRole('button', { name: 'Use my current location' });

/** The live input each instance is attached to, or null if it went stale. */
function boundTo(): (string | null)[] {
  const live = new Map<HTMLInputElement, string>([
    [pickupInput(), 'pickup'],
    [dropoffInput(), 'dropoff'],
  ]);
  return bound.map((b) => live.get(b.el) ?? null);
}

beforeEach(() => {
  toast.mockClear();
  mapsReady = false;
  bound.length = 0;
  cleared.length = 0;
});

afterEach(() => {
  delete (window as unknown as { google?: unknown }).google;
});

describe('address autocomplete', () => {
  it('binds one autocomplete to each address field', () => {
    stubMaps();
    render(<NewDeliveryForm user={user} params={params} options={options} />);

    expect(boundTo()).toEqual(['pickup', 'dropoff']);
  });

  /**
   * The reported bug, end to end. Filling the pickup from the device is the last
   * thing a merchant does before typing the drop-off, so it was the obvious
   * suspect — but the geocode call and the state it writes leave both fields
   * bound to the same live inputs. What actually broke the drop-off was Places
   * never being attached in the first place; see MapsProvider.test.tsx.
   */
  it('keeps both fields bound after the location button fills the pickup', async () => {
    const person = userEvent.setup();
    stubMaps();
    grantPosition();

    render(<NewDeliveryForm user={user} params={params} options={options} />);
    await person.click(locateButton());
    await waitFor(() => expect(pickupInput().value).toBe('48 Oxford St, Accra, Ghana'));

    expect(boundTo()).toEqual(['pickup', 'dropoff']);

    await person.type(dropoffInput(), 'East Legon');
    expect(boundTo()).toEqual(['pickup', 'dropoff']);
    // And no second pair was created along the way, which would leave two
    // instances fighting over each field.
    expect(bound).toHaveLength(2);
  });

  /**
   * Autocomplete keeps listeners on the input it was given and drops none of
   * them on its own, so each visit to this tab would otherwise leave another
   * pair behind — and React's development double-invoke leaves two per field
   * before a merchant has typed anything.
   */
  it('unbinds its instances when the form goes away', () => {
    stubMaps();
    const view = render(<NewDeliveryForm user={user} params={params} options={options} />);
    const instances = bound.map((b) => b.instance);

    view.unmount();

    expect(cleared).toEqual(instances);
  });

  it('binds nothing, and does not throw, when the SDK is not up', () => {
    render(<NewDeliveryForm user={user} params={params} options={options} />);

    expect(bound).toHaveLength(0);
  });
});
