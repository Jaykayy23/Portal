import { render, screen } from '@testing-library/react';
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

/** The two flags the provider exposes. Reassigned per test, read at render. */
let ready = false;
let placesReady = false;

vi.mock('@/components/MapsProvider', () => ({
  useMaps: () => ({ ready, placesReady, configured: true }),
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

/** The core namespace only — Geocoder is up, Places has not landed. */
function stubCoreOnly() {
  (window as unknown as { google: unknown }).google = {
    maps: {
      Geocoder: class {},
      DistanceMatrixService: class {},
      event: { clearInstanceListeners: (i: object) => cleared.push(i) },
    },
  };
}

function stubPlaces() {
  const g = (window as unknown as { google: { maps: Record<string, unknown> } }).google;
  g.maps.places = { Autocomplete: FakeAutocomplete };
}

function form() {
  return <NewDeliveryForm user={user} params={params} options={options} />;
}

function pickupInput(): HTMLInputElement {
  return screen.getByPlaceholderText('e.g. Osu, Oxford Street') as HTMLInputElement;
}

function dropoffInput(): HTMLInputElement {
  return screen.getByPlaceholderText('e.g. East Legon, American House') as HTMLInputElement;
}

beforeEach(() => {
  ready = false;
  placesReady = false;
  bound.length = 0;
  cleared.length = 0;
  toast.mockClear();
});

afterEach(() => {
  delete (window as unknown as { google?: unknown }).google;
});

describe('NewDeliveryForm address autocomplete', () => {
  it('binds both address fields once places is up', () => {
    ready = true;
    placesReady = true;
    stubCoreOnly();
    stubPlaces();

    render(form());

    expect(bound.map((b) => b.el)).toEqual([pickupInput(), dropoffInput()]);
  });

  /**
   * The core SDK arriving is not the cue. Binding here finds no `places` to
   * bind to, and the effect never runs again — which is the drop-off field
   * that suggests nothing until the page is left and revisited.
   */
  it('does not bind while only the core SDK is up', () => {
    ready = true;
    placesReady = false;
    stubCoreOnly();

    render(form());

    expect(bound).toHaveLength(0);
  });

  it('binds when places arrives after the form is already on screen', () => {
    ready = true;
    placesReady = false;
    stubCoreOnly();

    const { rerender } = render(form());
    expect(bound).toHaveLength(0);

    // Places lands; the provider flips the flag and the form gets its cue.
    stubPlaces();
    placesReady = true;
    rerender(form());

    expect(bound.map((b) => b.el)).toEqual([pickupInput(), dropoffInput()]);
  });

  it('drops its listeners when the form goes away', () => {
    ready = true;
    placesReady = true;
    stubCoreOnly();
    stubPlaces();

    const { unmount } = render(form());
    const instances = bound.map((b) => b.instance);
    expect(instances).toHaveLength(2);

    unmount();

    expect(cleared).toEqual(instances);
  });
});
