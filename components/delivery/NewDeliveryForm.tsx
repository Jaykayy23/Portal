'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errMessage } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { SURCHARGE_OPTIONS, calcPrice } from '@/lib/pricing';
import { useToast } from '@/components/Toast';
import { useMaps } from '@/components/MapsProvider';
import { NotifyModal } from '@/components/delivery/NotifyModal';
import {
  DELIVERY_TYPES,
  type DeliveryType,
  type DeliveryWithMerchant,
  type PricingParams,
  type SessionUser,
} from '@/lib/types';

/** Distance at which the route progress bar is full. Cosmetic only. */
const ROUTE_BAR_MAX_KM = 20;

export function NewDeliveryForm({
  user,
  params,
}: {
  user: SessionUser;
  params: PricingParams;
}) {
  const router = useRouter();
  const toast = useToast();
  const maps = useMaps();

  const pickupRef = useRef<HTMLInputElement>(null);
  const dropoffRef = useRef<HTMLInputElement>(null);

  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [distance, setDistance] = useState('');
  const [type, setType] = useState<DeliveryType>('Standard');
  const [surcharges, setSurcharges] = useState<string[]>([]);
  const [declaredValue, setDeclaredValue] = useState('');
  const [customer, setCustomer] = useState(user.role === 'merchant' ? user.companyName : '');
  const [agreed, setAgreed] = useState('');
  const [agreedEdited, setAgreedEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [notify, setNotify] = useState<DeliveryWithMerchant | null>(null);

  const km = parseFloat(distance) || 0;

  // Preview only. The Route Handler recalculates from the same parameters and
  // stores its own result, so this can never inflate or discount a real quote.
  const quote = useMemo(() => calcPrice(params, km, surcharges), [params, km, surcharges]);

  // Mirror the recommended price into the agreed field until someone types over
  // it, matching the original portal's behaviour.
  const agreedValue = agreedEdited ? agreed : quote.recommended.toFixed(2);
  const agreedNumber = parseFloat(agreedValue) || 0;
  const belowMinimum = agreedNumber > 0 && agreedNumber < quote.minimum;

  // Places autocomplete on both address fields, once the SDK is up.
  useEffect(() => {
    if (!maps.ready || !window.google?.maps?.places) return;
    const opts: google.maps.places.AutocompleteOptions = {
      componentRestrictions: { country: 'gh' },
    };
    const fields: [HTMLInputElement | null, (v: string) => void][] = [
      [pickupRef.current, setPickup],
      [dropoffRef.current, setDropoff],
    ];
    for (const [el, set] of fields) {
      if (!el) continue;
      const ac = new window.google.maps.places.Autocomplete(el, opts);
      // Autocomplete writes straight to the DOM node, so mirror it back into
      // React state or the value would be lost on the next render.
      ac.addListener('place_changed', () => set(el.value));
    }
  }, [maps.ready]);

  function toggleSurcharge(id: string) {
    setSurcharges((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function getDistanceFromMaps() {
    if (!maps.ready || !window.google?.maps) {
      toast('Google Maps is not ready yet');
      return;
    }
    if (!pickup.trim() || !dropoff.trim()) {
      toast('Enter both pickup and drop-off first');
      return;
    }
    setCalculating(true);
    new window.google.maps.DistanceMatrixService().getDistanceMatrix(
      {
        origins: [pickup.trim()],
        destinations: [dropoff.trim()],
        travelMode: window.google.maps.TravelMode.DRIVING,
        unitSystem: window.google.maps.UnitSystem.METRIC,
      },
      (response, status) => {
        setCalculating(false);
        const element = response?.rows?.[0]?.elements?.[0];
        if (status === 'OK' && element?.status === 'OK' && element.distance) {
          setDistance((element.distance.value / 1000).toFixed(1));
          toast('Distance filled from Google Maps');
        } else {
          toast('Could not calculate that route — enter distance manually');
        }
      }
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pickup.trim() || !dropoff.trim() || !km) {
      toast('Add pickup, drop-off and distance first');
      return;
    }
    if (!declaredValue || Number(declaredValue) <= 0) {
      toast('Declared value of the item is required');
      return;
    }

    setBusy(true);
    try {
      const data = await api<{ delivery: DeliveryWithMerchant }>('/deliveries', {
        method: 'POST',
        body: {
          pickup: pickup.trim(),
          dropoff: dropoff.trim(),
          distance: km,
          type,
          surcharges,
          declaredValue: Number(declaredValue),
          agreed: agreedNumber,
          customer: customer.trim() || user.companyName,
        },
      });

      toast(
        data.delivery.status === 'Requires approval'
          ? 'Logged — flagged for approval'
          : 'Delivery request logged'
      );

      setPickup('');
      setDropoff('');
      setDistance('');
      setDeclaredValue('');
      setSurcharges([]);
      setAgreed('');
      setAgreedEdited(false);
      // So the delivery log tab reflects the new row without a manual reload.
      router.refresh();
      setNotify(data.delivery);
    } catch (err) {
      toast(errMessage(err));
    }
    setBusy(false);
  }

  return (
    <>
      <form className="somo-grid" onSubmit={submit}>
        <div>
          <div className="somo-card">
            <h3>
              <span className="n">01</span> Trip details
            </h3>

            <div className="somo-route">
              <div className="dot a" />
              <div className="line">
                <div
                  className="line-fill"
                  style={{ width: `${(Math.min(km, ROUTE_BAR_MAX_KM) / ROUTE_BAR_MAX_KM) * 100}%` }}
                />
              </div>
              <div className="dot b" />
              <div className="dist">{km.toFixed(1)} km</div>
            </div>

            <label className="somo-field">
              <span>Pickup location</span>
              <input
                ref={pickupRef}
                className="somo-input"
                placeholder="e.g. Osu, Oxford Street"
                value={pickup}
                onChange={(e) => setPickup(e.target.value)}
              />
            </label>

            <label className="somo-field">
              <span>Drop-off location</span>
              <input
                ref={dropoffRef}
                className="somo-input"
                placeholder="e.g. East Legon, American House"
                value={dropoff}
                onChange={(e) => setDropoff(e.target.value)}
              />
            </label>

            <label className="somo-field">
              <span>Driving distance (km)</span>
              <div className="somo-inline-btn-row">
                <input
                  className="somo-input"
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="0.0"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                />
                <button
                  type="button"
                  className="somo-mini-btn"
                  disabled={!maps.ready || calculating}
                  onClick={getDistanceFromMaps}
                  title={
                    maps.configured
                      ? 'Look up the driving distance with Google Maps'
                      : 'Ask an admin to add a Google Maps API key in Settings'
                  }
                >
                  {calculating ? 'Calculating…' : 'Get from Maps'}
                </button>
              </div>
            </label>

            {!maps.ready && (
              <div className="somo-maps-hint">
                Manual entry is active. An admin can add a Google Maps API key (Places + Distance
                Matrix) in the Settings tab to enable location autocomplete and automatic
                driving-distance lookup for everyone.
              </div>
            )}

            <label className="somo-field">
              <span>Delivery type</span>
              <select
                className="somo-select"
                value={type}
                onChange={(e) => setType(e.target.value as DeliveryType)}
              >
                {DELIVERY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="somo-field">
              <span>Surcharges</span>
              <div className="somo-checks">
                {SURCHARGE_OPTIONS.map((opt) => {
                  const checked = surcharges.includes(opt.id);
                  return (
                    <label key={opt.id} className={`somo-check${checked ? ' checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSurcharge(opt.id)}
                      />{' '}
                      {opt.label} (+GHS {opt.amount})
                    </label>
                  );
                })}
              </div>
            </label>

            <label className="somo-field">
              <span>Declared value of item (GHS, required)</span>
              <input
                className="somo-input"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 300"
                value={declaredValue}
                onChange={(e) => setDeclaredValue(e.target.value)}
              />
            </label>
            <div className="somo-note borderless">
              Used for handling care and liability — required before a request can be logged.
            </div>
          </div>
        </div>

        <div>
          <div className="somo-card">
            <h3>
              <span className="n">02</span> Recommended price
            </h3>

            <div className="somo-price-box">
              <div className="somo-price-row main">
                <span className="l">Recommended</span>
                <span className="v">{fmtMoney(quote.recommended)}</span>
              </div>
              <div className="somo-divider" />
              <div className="somo-price-row">
                <span className="l">Minimum negotiable</span>
                <span className="v">{fmtMoney(quote.minimum)}</span>
              </div>
              <div className="somo-price-row">
                <span className="l">Base fare + distance</span>
                <span className="v">
                  GHS {params.base} + {params.rate}/km × {km.toFixed(1)}km
                </span>
              </div>
            </div>

            <label className="somo-field">
              <span>Corporate customer / merchant</span>
              <input
                className="somo-input"
                placeholder="Company name"
                value={customer}
                // A merchant always files under their own company name — the
                // server enforces this too, so the field is just read-only here.
                readOnly={user.role === 'merchant'}
                onChange={(e) => setCustomer(e.target.value)}
              />
            </label>

            <label className="somo-field">
              <span>Agreed price (GHS)</span>
              <input
                className="somo-input"
                type="number"
                min="0"
                step="0.5"
                placeholder="0.00"
                value={agreedValue}
                onChange={(e) => {
                  setAgreedEdited(true);
                  setAgreed(e.target.value);
                }}
              />
            </label>

            <div className={`somo-flag${belowMinimum ? ' show' : ''}`}>
              ⚠ Agreed price is below the minimum negotiable price. This quote will be logged as{' '}
              <strong>requires approval</strong>.
            </div>

            <button className="somo-btn" type="submit" disabled={busy}>
              {busy ? 'Logging…' : 'Log delivery request'}
            </button>
          </div>
        </div>
      </form>

      <NotifyModal record={notify} opsPhone={params.opsPhone} onClose={() => setNotify(null)} />
    </>
  );
}
