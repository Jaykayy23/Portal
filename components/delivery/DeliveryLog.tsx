'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errMessage } from '@/lib/api';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { NotifyModal } from '@/components/delivery/NotifyModal';
import {
  DELIVERY_STATUSES,
  type DeliveryStatus,
  type DeliveryWithMerchant,
  type Rider,
} from '@/lib/types';

const STATUS_CLASS: Record<DeliveryStatus, string> = {
  Requested: 'b-requested',
  'Requires approval': 'b-approval',
  Approved: 'b-assigned',
  Assigned: 'b-assigned',
  Delivered: 'b-delivered',
};

export function DeliveryLog({
  records,
  riders,
  opsPhone,
  canManage,
}: {
  records: DeliveryWithMerchant[];
  riders: Rider[];
  opsPhone: string;
  /** Ops/admin get inline status + rider controls; merchants get read-only rows. */
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [notify, setNotify] = useState<DeliveryWithMerchant | null>(null);

  if (records.length === 0) {
    return (
      <div className="somo-empty">
        <div className="big">No deliveries logged yet</div>
        {canManage
          ? 'Nothing has been requested by any merchant yet.'
          : 'Requests you submit will show up here — visible only to you.'}
      </div>
    );
  }

  async function changeStatus(id: string, status: DeliveryStatus) {
    try {
      await api('/deliveries/' + id, { method: 'PATCH', body: { status } });
      toast('Status updated');
      router.refresh();
    } catch (e) {
      toast(errMessage(e));
      // Re-sync the select with whatever the server actually has.
      router.refresh();
    }
  }

  async function assignRider(id: string, riderId: string) {
    try {
      const data = await api<{ delivery: DeliveryWithMerchant }>('/deliveries/' + id, {
        method: 'PATCH',
        body: { riderId },
      });
      toast(riderId ? `Assigned to ${data.delivery.riderName}` : 'Rider unassigned');
      router.refresh();
      if (riderId) setNotify(data.delivery);
    } catch (e) {
      toast(errMessage(e));
      router.refresh();
    }
  }

  return (
    <>
      <div className="somo-table-wrap">
        <table className="somo-table">
          <thead>
            <tr>
              <th>Date</th>
              {canManage && <th>Customer</th>}
              <th>Route</th>
              <th>Distance</th>
              <th>Type</th>
              <th>Value</th>
              <th>Recommended</th>
              <th>Agreed</th>
              <th>Status</th>
              <th>Rider</th>
              {canManage && <th>Alerts</th>}
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {fmtDateTime(r.date)}
                </td>
                {canManage && <td>{r.customer}</td>}
                <td>
                  {r.pickup} → {r.dropoff}
                </td>
                <td className="somo-price-cell">{r.distance.toFixed(1)} km</td>
                <td>{r.type}</td>
                <td className="somo-price-cell">GHS {(r.declaredValue || 0).toFixed(0)}</td>
                <td className="somo-price-cell">{fmtMoney(r.recommended)}</td>
                <td className="somo-agreed-cell">{fmtMoney(r.agreed)}</td>

                <td>
                  {canManage ? (
                    <select
                      className="somo-status-select"
                      value={r.status}
                      onChange={(e) => changeStatus(r.id, e.target.value as DeliveryStatus)}
                    >
                      {DELIVERY_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={`somo-badge ${STATUS_CLASS[r.status] || 'b-requested'}`}>
                      {r.status}
                    </span>
                  )}
                </td>

                <td>
                  {canManage ? (
                    <select
                      className="somo-status-select"
                      value={r.riderId}
                      onChange={(e) => assignRider(r.id, e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {riders.map((rider) => (
                        <option key={rider.id} value={rider.id}>
                          {rider.name} — {rider.regNumber || 'no reg'} ({rider.status})
                        </option>
                      ))}
                    </select>
                  ) : r.riderName ? (
                    <>
                      {r.riderName}
                      <br />
                      <span className="somo-rider-sub">
                        {r.riderPhone} · {r.riderModel} {r.riderReg}
                      </span>
                    </>
                  ) : (
                    <span className="somo-unassigned">Not yet assigned</span>
                  )}
                </td>

                {canManage && (
                  <td>
                    <button className="somo-notify-btn" onClick={() => setNotify(r)}>
                      🔔 Notify
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NotifyModal record={notify} opsPhone={opsPhone} onClose={() => setNotify(null)} />
    </>
  );
}
