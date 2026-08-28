'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LocateFixed } from 'lucide-react';
import { api, errMessage } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { calcPrice } from '@/lib/pricing';
import { isValidPhone } from '@/lib/phone';
import { useToast } from '@/components/Toast';
import { useMaps } from '@/components/MapsProvider';
import { InfoHint } from '@/components/InfoHint';
import { Spinner } from '@/components/Spinner';
import { NotifyModal } from '@/components/delivery/NotifyModal';
import {
  DEFAULT_DELIVERY_TYPE,
  DELIVERY_PAYERS,
  ITEM_PAYMENTS,
  type DeliveryOptions,
  type DeliveryPayer,
  type ItemPayment,
  type DeliveryWithMerchant,
  type PricingParams,
  type SessionUser,
} from '@/lib/types';

/** Distance at which the route progress bar is full. Cosmetic only. */
const ROUTE_BAR_MAX_KM = 20;

/** An Open Location Code at the head of an address — "HR48+HX2, Oxford St, …". */
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\b/i;

/**
 * Picks the line a rider can actually use out of a reverse-geocode response.
 *
 * Google's first result for a bare coordinate is usually the nearest
 * establishment carrying a Plus Code — standing on Oxford Street it answers
 * "HR48+HX2, Oxford St, Accra, Ghana" before it offers "48 Oxford St, Accra,
 * Ghana" further down. Both route; only one is something a rider reads out over
 * the phone. So a street address wins where the response carries one, and the
 * Plus Code line is taken only when nothing else is on offer.
 */
function readableAddress(results: google.maps.GeocoderResult[] | null): string {
  const usable = (results ?? []).filter((r) => !PLUS_CODE.test(r.formatted_address));
  const street = usable.find((r) => r.types.includes('street_address'));
  return (street ?? usable[0] ?? results?.[0])?.formatted_address ?? '';
}

export function NewDeliveryForm({
  user,
  params,
  options,
}: {
  user: SessionUser;
  params: PricingParams;
  options: DeliveryOptions;
}) {
  const router = useRouter();
  const toast = useToast();
  const maps = useMaps();

  const pickupRef = useRef<HTMLInputElement>(null);
  const dropoffRef = useRef<HTMLInputElement>(null);
  /**
   * Identifies this submission attempt to the server, and survives a retry.
   *
   * Kept until a submission succeeds, then cleared. So a merchant whose request
   * reached the server but whose response was lost — the roadside-signal case —
   * gets back the delivery that was already filed when they tap again, instead
   * of filing a second one. A new form submission gets a new key.
   */
  const submitKey = useRef('');

  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [distance, setDistance] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [surcharges, setSurcharges] = useState<string[]>([]);
  const [declaredValue, setDeclaredValue] = useState('');
  // No sensible default for either: guessing "prepaid" would quietly tell a rider
  // not to collect money, so both start unset and the form insists on an answer.
  const [itemPayment, setItemPayment] = useState<ItemPayment | ''>('');
  const [deliveryPaidBy, setDeliveryPaidBy] = useState<DeliveryPayer | ''>('');
  const [customer, setCustomer] = useState(user.role === 'merchant' ? user.companyName : '');
  // The individual at the drop-off, not the merchant filing the request.
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [locating, setLocating] = useState(false);
  const [notify, setNotify] = useState<DeliveryWithMerchant | null>(null);

  const km = parseFloat(distance) || 0;
  const mins = parseFloat(durationMin) || 0;

  // Set by admin under Settings, so an install with none configured simply shows
  // no surge charge field.
  const surchargeOptions = params.surcharges ?? [];
  // Same deal: no categories configured, no category field — and the server skips
  // the requirement in exactly that case.
  const itemCategories = options.itemCategories ?? [];

  // Preview only. The Route Handler recalculates from the same parameters and
  // stores its own result, so this can never inflate or discount a real quote.
  const quote = useMemo(
    () => calcPrice(params, km, mins, surcharges),
    [params, km, mins, surcharges]
  );


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

  /**
   * Fills the pickup field from the device the form is being filled on.
   *
   * For the common case: the merchant is standing at the pickup. The browser
   * asks permission the first time and the answer is theirs to give — every
   * refusal here just leaves them typing the address, which is the same thing
   * they would have done anyway, so nothing is blocked on it.
   */
  function fillPickupFromDevice() {
    if (!navigator.geolocation) {
      toast('This browser cannot share your location — type the pickup address instead', 'danger');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = { lat: coords.latitude, lng: coords.longitude };
        const pair = `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
        // The device gives back coordinates; the field wants a line a rider can
        // read, which is what the geocoder turns them into. With no Maps key —
        // or no address on record for that spot — the pair is written in anyway
        // rather than discarded: it still routes, and the merchant can add the
        // landmark themselves.
        if (!maps.ready || !window.google?.maps) {
          setLocating(false);
          setPickup(pair);
          toast('Filled your coordinates — add a landmark so the rider can find you');
          return;
        }
        new window.google.maps.Geocoder().geocode({ location: point }, (results, status) => {
          setLocating(false);
          const address = status === 'OK' ? readableAddress(results) : '';
          if (address) {
            setPickup(address);
            toast('Pickup filled from your current location');
          } else {
            setPickup(pair);
            toast('Filled your coordinates — add a landmark so the rider can find you');
          }
        });
      },
      (err) => {
        setLocating(false);
        toast(
          err.code === err.PERMISSION_DENIED
            ? 'Location is turned off for this site — allow it in your browser, or type the address'
            : 'Could not get your location — type the pickup address instead',
          'danger'
        );
      },
      // High accuracy because a delivery pickup is a doorway, not a district.
      // The long timeout is for a first fix on a phone indoors; maximumAge 0 so
      // a merchant who has moved since the last request gets where they are now.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function toggleSurcharge(id: string) {
    setSurcharges((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  // Distance and time come from the same Distance Matrix response, so a route
  // lookup fills both inputs to the price in one call.
  function getRouteFromMaps() {
    if (!maps.ready || !window.google?.maps) {
      toast('Google Maps is not ready yet', 'danger');
      return;
    }
    if (!pickup.trim() || !dropoff.trim()) {
      toast('Enter both pickup and drop-off first', 'danger');
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
          // duration_in_traffic needs a departureTime on the request, which this
          // one does not set, so this is the typical-conditions estimate.
          if (element.duration) setDurationMin(Math.round(element.duration.value / 60).toFixed(0));
          toast('Distance and time filled from Google Maps');
        } else {
          toast('Could not calculate that route — enter distance manually', 'danger');
        }
      }
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pickup.trim() || !dropoff.trim() || !km) {
      toast('Add pickup, drop-off and distance first', 'danger');
      return;
    }
    if (itemCategories.length > 0 && !itemCategory) {
      toast('Choose what kind of item is being sent', 'danger');
      return;
    }
    if (!declaredValue || Number(declaredValue) <= 0) {
      toast('Cost of the item is required', 'danger');
      return;
    }
    if (!itemPayment) {
      toast('Say whether the item is prepaid or cash on delivery', 'danger');
      return;
    }
    if (!deliveryPaidBy) {
      toast('Say who is paying for the delivery', 'danger');
      return;
    }
    if (!recipientName.trim()) {
      toast("Enter the recipient's name", 'danger');
      return;
    }
    // Checked here for a fast answer; the server checks the same thing, and the
    // server's answer is the one that decides.
    if (!isValidPhone(recipientPhone)) {
      toast("Enter a valid phone number for the recipient", 'danger');
      return;
    }

    setBusy(true);
    try {
      if (!submitKey.current) submitKey.current = crypto.randomUUID();

      const data = await api<{ delivery: DeliveryWithMerchant; alertsSent: boolean }>('/deliveries', {
        method: 'POST',
        idempotencyKey: submitKey.current,
        body: {
          pickup: pickup.trim(),
          dropoff: dropoff.trim(),
          distance: km,
          durationMin: mins,
          type: DEFAULT_DELIVERY_TYPE,
          itemCategory,
          surcharges,
          declaredValue: Number(declaredValue),
          itemPayment,
          deliveryPaidBy,
          customer: customer.trim() || user.companyName,
          recipientName: recipientName.trim(),
          recipientPhone: recipientPhone.trim(),
        },
      });

      toast(data.alertsSent ? 'Delivery request logged — ops alerted by SMS' : 'Delivery request logged');

      // Consumed: the next submission is a different delivery.
      submitKey.current = '';

      setPickup('');
      setDropoff('');
      setDistance('');
      setDurationMin('');
      setDeclaredValue('');
      setItemPayment('');
      setDeliveryPaidBy('');
      setRecipientName('');
      setRecipientPhone('');
      setItemCategory('');
      setSurcharges([]);
      // So the delivery log tab reflects the new row without a manual reload.
      router.refresh();
      // The ops alert has already gone out by SMS, so there is nothing to open a
      // modal for. The modal is only for the portals that cannot send — there it
      // is still the way the message reaches ops, from this device.
      if (!data.alertsSent) setNotify(data.delivery);
    } catch (err) {
      toast(errMessage(err), 'danger');
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
                  style={{
                    transform: `scaleX(${Math.min(km, ROUTE_BAR_MAX_KM) / ROUTE_BAR_MAX_KM})`,
                  }}
                />
              </div>
              <div className="dot b" />
              <div className="dist">
                {km.toFixed(1)} km{mins > 0 ? ` · ${mins.toFixed(0)} min` : ''}
              </div>
            </div>

            <label className="somo-field">
              <span>Pickup location</span>
              <div className="somo-input-with-action">
                <input
                  ref={pickupRef}
                  className="somo-input"
                  placeholder="e.g. Osu, Oxford Street"
                  value={pickup}
                  onChange={(e) => setPickup(e.target.value)}
                />
                {/* A button inside the label does not hand its click to the
                    input — interactive descendants keep their own activation —
                    so this cannot steal focus or open the autocomplete list. */}
                <button
                  type="button"
                  className="somo-input-action"
                  onClick={fillPickupFromDevice}
                  disabled={locating}
                  aria-label="Use my current location"
                  title="Use my current location"
                >
                  {locating ? (
                    <Spinner size={16} label="Finding your location" />
                  ) : (
                    <LocateFixed aria-hidden="true" size={16} />
                  )}
                </button>
              </div>
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
                  readOnly={maps.ready}
                  title={maps.ready ? 'Filled automatically by Get from Maps' : undefined}
                />
                <button
                  type="button"
                  className="somo-mini-btn"
                  disabled={!maps.ready || calculating}
                  onClick={getRouteFromMaps}
                  title={
                    maps.configured
                      ? 'Look up the driving distance and time with Google Maps'
                      : 'Ask an admin to add a Google Maps API key in Settings'
                  }
                >
                  {calculating ? <Spinner size={13} /> : null}
                  {calculating ? 'Calculating…' : 'Get from Maps'}
                </button>
              </div>
            </label>

            {!maps.ready && (
              <div className="somo-maps-hint">
                Manual entry — type the distance and time yourself. An admin can switch on
                autocomplete and automatic lookup by adding a Google Maps key (Places + Distance
                Matrix) under Settings.
              </div>
            )}

            <label className="somo-field">
              <span>
                Estimated driving time (min)
                {params.perMin > 0 && (
                  <InfoHint label="estimated driving time">
                    <p>
                      Priced at GHS {params.perMin}/min, so a slow route through traffic costs more
                      than an open run of the same distance.
                    </p>
                    <p>
                      Filled by <strong>Get from Maps</strong>. Left at 0, the quote is on
                      distance alone.
                    </p>
                  </InfoHint>
                )}
              </span>
              <input
                className="somo-input"
                type="number"
                min="0"
                step="1"
                placeholder="0"
                value={durationMin}
                onChange={(e) => setDurationMin(e.target.value)}
                readOnly={maps.ready}
                title={maps.ready ? 'Filled automatically by Get from Maps' : undefined}
              />
            </label>

            <label className="somo-field">
              <span>Delivery type</span>
              {/* One service, so nothing to choose: the rider goes when the
                  request comes in. Shown rather than hidden because the log,
                  the exports and the rider's job offer all carry it, and the
                  server files it as this whatever a crafted request sends. */}
              <input
                className="somo-input"
                value={DEFAULT_DELIVERY_TYPE}
                readOnly
              />
            </label>

            {itemCategories.length > 0 && (
              <label className="somo-field">
                <span>What is being sent</span>
                <select
                  className="somo-select"
                  value={itemCategory}
                  onChange={(e) => setItemCategory(e.target.value)}
                >
                  <option value="">Select item category…</option>
                  {itemCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {surchargeOptions.length > 0 && (
              <label className="somo-field">
                <span>Surge charges</span>
                <div className="somo-checks">
                  {surchargeOptions.map((opt) => {
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
            )}

            <label className="somo-field">
              <span>
                Cost of Item (GHS, required)
                <InfoHint label="cost of item">
                  <p>What the item is worth. It covers handling care and liability.</p>
                  <p>
                    On a cash-on-delivery request this is also the sum the rider collects at the
                    door.
                  </p>
                </InfoHint>
              </span>
              <input
                className="somo-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 300"
                value={declaredValue}
                onChange={(e) => setDeclaredValue(e.target.value)}
              />
            </label>
            <label className="somo-field">
              <span>
                Item payment (required)
                <InfoHint label="the two payment answers">
                  <p>
                    Two independent questions: whether the <strong>item</strong> is already paid
                    for, and who settles the <strong>delivery fee</strong>. All four combinations
                    are valid.
                  </p>
                  <p>
                    Both answers go into the rider&rsquo;s alert, so they know exactly what to
                    collect at the door — and what not to.
                  </p>
                </InfoHint>
              </span>
              <select
                className="somo-select"
                value={itemPayment}
                onChange={(e) => setItemPayment(e.target.value as ItemPayment)}
              >
                <option value="">Select…</option>
                {ITEM_PAYMENTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="somo-field">
              <span>Delivery fee paid by (required)</span>
              <select
                className="somo-select"
                value={deliveryPaidBy}
                onChange={(e) => setDeliveryPaidBy(e.target.value as DeliveryPayer)}
              >
                <option value="">Select…</option>
                {DELIVERY_PAYERS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

          </div>
        </div>

        <div>
          {/* Top of the right column, beside the route rather than below it: the
              recipient is short, and burying it under Trip details put it a long
              scroll away from the submit button. */}
          <div className="somo-card">
            <h3>
              <span className="n">02</span> Recipient
              <span className="tag-note">who is receiving it</span>
            </h3>

            <label className="somo-field">
              <span>Recipient name (required)</span>
              <input
                className="somo-input"
                placeholder="e.g. Ama Boateng"
                autoComplete="off"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
              />
            </label>

            <label className="somo-field">
              <span>Recipient phone (required)</span>
              <input
                className="somo-input"
                type="tel"
                inputMode="tel"
                placeholder="e.g. 024 123 4567"
                autoComplete="off"
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
              />
            </label>
            <div className="somo-note borderless">
              The rider gets these in their alert, so they can call ahead instead of
              waiting at the gate.
            </div>
          </div>

          <div className="somo-card">
            <h3>
              <span className="n">03</span> Price
              <InfoHint label="how this price is set">
                <p>
                  Computed from the pricing rules, and computed again on the server when the request
                  is filed — so this preview and the logged figure cannot disagree.
                </p>
                <p>It is the charged price, not a starting point. Nobody can type a different one.</p>
              </InfoHint>
              <span className="tag-note">set by the pricing rules</span>
            </h3>

            <div className="somo-price-box">
              <div className="somo-price-row main">
                <span className="l">Delivery price</span>
                <span className="v">{fmtMoney(quote.price)}</span>
              </div>
              <div className="somo-divider" />
              <div className="somo-price-row">
                <span className="l">Base fare + distance</span>
                <span className="v">
                  GHS {params.base} + {params.rate}/km × {km.toFixed(1)}km
                </span>
              </div>
              {params.perMin > 0 && (
                <div className="somo-price-row">
                  <span className="l">Time</span>
                  <span className="v">
                    GHS {params.perMin}/min × {mins.toFixed(0)}min
                  </span>
                </div>
              )}
              {/* A fee of 0 is one the portal does not charge, so it is left off
                  rather than shown as a line worth nothing. */}
              {params.bookingFee > 0 && (
                <div className="somo-price-row">
                  <span className="l">Booking fee</span>
                  <span className="v">{fmtMoney(params.bookingFee)}</span>
                </div>
              )}
              {params.platformFee > 0 && (
                <div className="somo-price-row">
                  <span className="l">Platform fee</span>
                  <span className="v">{fmtMoney(params.platformFee)}</span>
                </div>
              )}
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

            <button className="somo-btn" type="submit" disabled={busy}>
              {busy ? <Spinner /> : null}
              {busy ? 'Logging…' : 'Log delivery request'}
            </button>
          </div>
        </div>
      </form>

      <NotifyModal record={notify} opsPhone={params.opsPhone} onClose={() => setNotify(null)} />
    </>
  );
}
