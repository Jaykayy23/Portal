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

/** Whether the Maps SDK is up. Reassigned per test; read at render time. */
let mapsReady = false;

vi.mock('@/components/MapsProvider', () => ({
  // The location button needs the core SDK only, so `placesReady` tracks it
  // here — nothing in these tests turns on Places.
  useMaps: () => ({ ready: mapsReady, placesReady: mapsReady, configured: mapsReady }),
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

function pickupInput(): HTMLInputElement {
  return screen.getByPlaceholderText('e.g. Osu, Oxford Street') as HTMLInputElement;
}

function locateButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Use my current location' }) as HTMLButtonElement;
}

/** Stands in for the device, answering the next position request with `coords`. */
function grantPosition(coords: { latitude: number; longitude: number }) {
  const getCurrentPosition = vi.fn((success: PositionCallback) =>
    success({ coords } as GeolocationPosition)
  );
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition },
    configurable: true,
  });
  return getCurrentPosition;
}

/** Stands in for the device refusing, with one of the GeolocationPositionError codes. */
function refusePosition(code: number) {
  Object.defineProperty(navigator, 'geolocation', {
    value: {
      getCurrentPosition: vi.fn(
        (_success: PositionCallback, failure?: PositionErrorCallback | null) =>
          failure?.({ code, PERMISSION_DENIED: 1 } as GeolocationPositionError)
      ),
    },
    configurable: true,
  });
}

type StubResult = { formatted_address: string; types: string[] };

/** Stands in for the Maps SDK, with a geocoder that answers with `results`. */
function stubMaps(results: StubResult[] | null) {
  mapsReady = true;
  (window as unknown as { google: unknown }).google = {
    maps: {
      places: { Autocomplete: class {  addListener() {} } },
      Geocoder: class {
        geocode(_req: unknown, cb: (r: StubResult[] | null, s: string) => void) {
          if (results) cb(results, 'OK');
          else cb(null, 'ZERO_RESULTS');
        }
      },
    },
  };
}

/** What Google actually returned for a point on Oxford Street, Osu. */
const OSU_RESULTS: StubResult[] = [
  { formatted_address: 'HR48+HX2, Oxford St, Accra, Ghana', types: ['establishment', 'point_of_interest'] },
  { formatted_address: 'HR48+HR9, Oxford St, Accra, Ghana', types: ['premise', 'street_address'] },
  { formatted_address: '48 Oxford St, Accra, Ghana', types: ['street_address'] },
  { formatted_address: 'HR48+GX Accra, Ghana', types: ['plus_code'] },
  { formatted_address: 'Osu, Accra, Ghana', types: ['neighborhood', 'political'] },
];

beforeEach(() => {
  toast.mockClear();
  mapsReady = false;
});

afterEach(() => {
  delete (window as unknown as { google?: unknown }).google;
});

describe('pickup location button', () => {
  /** The whole point of it: standing at the pickup, one tap fills the address. */
  it('writes the geocoded address into the pickup field', async () => {
    const person = userEvent.setup();
    stubMaps([{ formatted_address: '48 Oxford St, Accra, Ghana', types: ['street_address'] }]);
    grantPosition({ latitude: 5.5563, longitude: -0.1826 });

    render(<NewDeliveryForm user={user} params={params} options={options} />);
    await person.click(locateButton());

    await waitFor(() => expect(pickupInput().value).toBe('48 Oxford St, Accra, Ghana'));
  });

  /**
   * Google leads with the nearest establishment and a Plus Code in front of it.
   * A rider cannot read "HR48+HX2" down a phone, so the street address further
   * down the response is the one that belongs in the field.
   */
  it('prefers the street address over the Plus Code Google returns first', async () => {
    const person = userEvent.setup();
    stubMaps(OSU_RESULTS);
    grantPosition({ latitude: 5.5563, longitude: -0.1826 });

    render(<NewDeliveryForm user={user} params={params} options={options} />);
    await person.click(locateButton());

    await waitFor(() => expect(pickupInput().value).toBe('48 Oxford St, Accra, Ghana'));
  });

  /** Somewhere with no street address on record still beats an empty field. */
  it('falls back to the Plus Code line when it is the only thing on offer', async () => {
    const person = userEvent.setup();
    stubMaps([{ formatted_address: 'HR48+GX Accra, Ghana', types: ['plus_code'] }]);
    grantPosition({ latitude: 5.5563, longitude: -0.1826 });

    render(<NewDeliveryForm user={user} params={params} options={options} />);
    await person.click(locateButton());

    await waitFor(() => expect(pickupInput().value).toBe('HR48+GX Accra, Ghana'));
  });

  /** No street address, but a neighbourhood is still a place a rider can head for. */
  it('takes the nearest named place when no street address came back', async () => {
    const person = userEvent.setup();
    stubMaps([
      { formatted_address: 'HR48+HX2, Oxford St, Accra, Ghana', types: ['establishment'] },
      { formatted_address: 'Osu, Accra, Ghana', types: ['neighborhood', 'political'] },
    ]);
    grantPosition({ latitude: 5.5563, longitude: -0.1826 });

    render(<NewDeliveryForm user={user} params={params} options={options} />);
    await person.click(locateButton());

    await waitFor(() => expect(pickupInput().value).toBe('Osu, Accra, Ghana'));
  });

  /**
   * Without a Maps key there is no address to look up, but the coordinates are
   * still a real answer — better in the field, with a nudge to add a landmark,
   * than thrown away.
   */
  it('falls back to coordinates when Maps is not loaded', async () => {
    const person = userEvent.setup();
    grantPosition({ latitude: 5.5563, longitude: -0.1826 });

    render(<NewDeliveryForm user={user} params={params} options={options} />);
    await person.click(locateButton());

    await waitFor(() => expect(pickupInput().value).toBe('5.556300, -0.182600'));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('landmark'));
  });

  it('falls back to coordinates when Google has no address for the spot', async () => {
    const person = userEvent.setup();
    stubMaps(null);
    grantPosition({ latitude: 5.5563, longitude: -0.1826 });

    render(<NewDeliveryForm user={user} params={params} options={options} />);
    await person.click(locateButton());

    await waitFor(() => expect(pickupInput().value).toBe('5.556300, -0.182600'));
  });

  /** A refusal leaves them typing, which is what they would have done anyway. */
  it('leaves the field alone and says what to do when permission is denied', async () => {
    const person = userEvent.setup();
    refusePosition(1);

    render(<NewDeliveryForm user={user} params={params} options={options} />);
    await person.click(locateButton());

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('turned off for this site'), 'danger')
    );
    expect(pickupInput().value).toBe('');
  });

  it('gives a different plain sentence when the fix simply fails', async () => {
    const person = userEvent.setup();
    refusePosition(2);

    render(<NewDeliveryForm user={user} params={params} options={options} />);
    await person.click(locateButton());

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining('Could not get your location'),
        'danger'
      )
    );
  });

  /**
   * The button sits inside the field's <label>. A label hands its click to the
   * input it wraps — but not one aimed at an interactive descendant, or every
   * tap would also open the autocomplete list over the answer.
   */
  it('does not focus the pickup input when clicked', async () => {
    const person = userEvent.setup();
    stubMaps(OSU_RESULTS);
    grantPosition({ latitude: 5.5563, longitude: -0.1826 });

    render(<NewDeliveryForm user={user} params={params} options={options} />);
    await person.click(locateButton());

    expect(document.activeElement).not.toBe(pickupInput());
  });
});
