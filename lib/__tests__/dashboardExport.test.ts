import { describe, expect, it } from 'vitest';
import { dashboardFileName, dashboardToCsv, dashboardToXlsx } from '@/lib/dashboardExport';
import type { DeliveryWithMerchant } from '@/lib/types';

// The CSV renderer is the half worth testing directly: it is plain text, so its
// output can be asserted on, and it carries the two rules that are easy to break
// silently — the formula guard on user-typed cells, and numbers written bare so
// the file can be summed by whatever reads it next. The workbook shares the
// section model underneath, so a section missing here would be missing there too.

const NOW = new Date('2026-08-28T12:00:00.000Z');

function delivery(over: Partial<DeliveryWithMerchant> = {}): DeliveryWithMerchant {
  return {
    id: 'a1b2c3d4-0000-0000-0000-000000000001',
    date: '2026-08-27T09:00:00.000Z',
    customer: 'Kofi Stores',
    recipientName: 'Ama Boateng',
    recipientPhone: '0201234567',
    merchantId: 'm1',
    submittedBy: 'u1',
    pickup: 'Osu',
    dropoff: 'Labone',
    distance: 4.5,
    durationMin: 18,
    type: 'On demand',
    itemCategory: 'Food',
    surcharges: [],
    declaredValue: 120,
    itemPayment: 'Cash on delivery',
    deliveryPaidBy: 'Merchant',
    price: 25,
    status: 'Delivered',
    riderId: 'r1',
    riderName: 'Yaw Mensah',
    riderPhone: '0209876543',
    riderReg: 'GR 1234-24',
    riderModel: 'Boxer',
    acceptedAt: '2026-08-27T09:05:00.000Z',
    declinedAt: '',
    pickedUpAt: '2026-08-27T09:20:00.000Z',
    recipientConfirmedAt: '2026-08-27T10:00:00.000Z',
    deliveredAt: '2026-08-27T10:00:00.000Z',
    ...over,
  };
}

const OPTS = {
  range: '30d' as const,
  includeMerchants: true,
  scopeLabel: 'All merchants · Last 30 days',
  now: NOW,
};

/** Every section title, in the order the file writes them. */
const TITLES = [
  'Overview',
  'Day by day',
  'Where deliveries sit',
  'The goods — how they were paid for',
  'The delivery fee — who pays it',
  'What is being sent',
  'Busiest drop-offs',
  'Merchants',
  'Riders',
  'Repeat recipients',
];

/**
 * One section's lines, from its title to the next one.
 *
 * Bounded by the next *title* rather than by the next blank line, because the
 * Overview puts a blank line between each of its groups — stopping at the first
 * one would silently return only 'Volume' and let an assertion about the money
 * figures pass for the wrong reason.
 */
function sectionOf(csv: string, title: string): string {
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  const start = lines.indexOf(title);
  expect(start, `section "${title}" is in the file`).toBeGreaterThan(-1);

  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (TITLES.includes(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

describe('dashboardToCsv', () => {
  it('opens with a BOM and a provenance block naming the scope, period and currency', () => {
    const csv = dashboardToCsv([delivery()], OPTS);

    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Scope,All merchants · Last 30 days');
    expect(csv).toContain('Period,Last 30 days');
    expect(csv).toContain(`Generated,${NOW.toISOString()}`);
    expect(csv).toContain('Amounts,GHS');
    // CRLF throughout, so Excel on Windows does not run the rows together.
    expect(csv.includes('\r\n')).toBe(true);
  });

  it('writes money and shares as bare numbers, not as formatted strings', () => {
    const csv = dashboardToCsv([delivery({ price: 25 }), delivery({ price: 75 })], OPTS);
    const overview = sectionOf(csv, 'Overview');

    expect(overview).toContain('Deliveries filed,2');
    // 100.00, not 'GHS 100.00' — the column has to be summable.
    expect(overview).toContain('Delivery fees,100.00');
    expect(overview).toContain('Average fee per delivery,50.00');
    // The whole percentage, since a CSV has no display format to expand 1.0 back.
    expect(overview).toContain('Handed over (share),100.0');
    // The group headings survive, so the file reads like the cards it came from.
    expect(overview).toContain('Money in this period');
  });

  it('neutralises a merchant name that would otherwise run as a formula', () => {
    const csv = dashboardToCsv(
      [delivery({ customer: '=HYPERLINK("http://evil","click")', merchantId: 'm9' })],
      OPTS
    );
    const merchants = sectionOf(csv, 'Merchants');

    // Quoted for the comma, and prefixed so a spreadsheet reads it as text.
    expect(merchants).toContain(`"'=HYPERLINK`);
    // Nowhere in the section does the payload start a field unguarded.
    expect(merchants).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('escapes quotes and commas in an address per RFC 4180', () => {
    const csv = dashboardToCsv([delivery({ dropoff: 'The "Blue" House, Labone' })], OPTS);
    const dropoffs = sectionOf(csv, 'Busiest drop-offs');

    expect(dropoffs).toContain('"The ""Blue"" House, Labone",1,100.0,25.00');
  });

  it('carries every dashboard section, and drops the merchant table when told to', () => {
    const rows = [delivery(), delivery({ id: 'x2', recipientPhone: '0201234567' })];

    const withMerchants = dashboardToCsv(rows, OPTS);
    for (const title of TITLES) {
      expect(withMerchants, title).toContain(`\r\n${title}\r\n`);
    }

    const merchantOwn = dashboardToCsv(rows, { ...OPTS, includeMerchants: false });
    expect(merchantOwn).not.toContain('\r\nMerchants\r\n');
    // Still has the rest — dropping one section must not drop its neighbours.
    expect(merchantOwn).toContain('\r\nRiders\r\n');
  });

  it('says so when the daily breakdown is narrower than the period', () => {
    const rows = [delivery()];

    expect(dashboardToCsv(rows, { ...OPTS, range: 'all' })).toContain(
      'The last 30 days only'
    );
    expect(dashboardToCsv(rows, { ...OPTS, range: '7d' })).not.toContain('The last 30 days only');
  });

  it('leaves an incomplete-history notice where a reader meets it before any total', () => {
    const csv = dashboardToCsv([delivery()], { ...OPTS, notice: 'INCOMPLETE — only 500 rows.' });
    const body = csv.replace(/^﻿/, '');

    expect(body.indexOf('Notice,')).toBeLessThan(body.indexOf('Overview'));
  });

  it('writes dates as ISO, because the consumer of a CSV is another program', () => {
    const csv = dashboardToCsv([delivery({ date: '2026-08-27T09:00:00.000Z' })], OPTS);

    // The daily buckets key on the date alone; a "when" column keeps the time.
    expect(sectionOf(csv, 'Day by day')).toMatch(/^2026-08-27,1,1,25\.00$/m);
    expect(sectionOf(csv, 'Merchants')).toContain(',2026-08-27T09:00:00.000Z');
  });
});

describe('dashboardToXlsx', () => {
  // The cell union has to be mapped onto write-excel-file's own shapes, and a
  // wrong shape throws while zipping rather than at compile time. So this builds
  // a real workbook and unzips the sheet names back out of it.
  // fflate rather than a new dev dependency: write-excel-file zips with it, so
  // it is already installed, and unzipping with the same library is the closest
  // thing to reading back what was written.
  async function sheetNames(file: Buffer): Promise<string[]> {
    const { unzipSync, strFromU8 } = await import('fflate');
    const entries = unzipSync(new Uint8Array(file));
    const workbook = strFromU8(entries['xl/workbook.xml']);
    // `name` is not the first attribute on the tag, so it is matched positionally
    // within the element rather than straight after the element name.
    return [...workbook.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1]);
  }

  it('builds a real workbook with a sheet per dashboard card', async () => {
    const rows = [delivery(), delivery({ id: 'a2', price: 75 })];
    const file = await dashboardToXlsx(rows, OPTS);

    // 'PK' — it is a zip, so it actually got written rather than half-built.
    expect(file.subarray(0, 2).toString()).toBe('PK');
    expect(await sheetNames(file)).toEqual([
      'Summary',
      'Day by day',
      'Breakdowns',
      'Merchants',
      'Riders',
      'Repeat recipients',
    ]);
  });

  it('leaves out the sheets it has no rows for', async () => {
    // One delivery: nobody has received twice, and a merchant's own export
    // carries no league table.
    const file = await dashboardToXlsx([delivery()], { ...OPTS, includeMerchants: false });

    const names = await sheetNames(file);
    expect(names).toContain('Summary');
    expect(names).not.toContain('Merchants');
    expect(names).not.toContain('Repeat recipients');
  });

  it('survives the awkward rows — no fee, no category, no rider, no estimate', async () => {
    const file = await dashboardToXlsx(
      [
        delivery({
          price: 0,
          declaredValue: 0,
          distance: 0,
          durationMin: 0,
          itemCategory: '',
          itemPayment: '',
          deliveryPaidBy: '',
          riderId: '',
          riderName: '',
          status: 'Requested',
          deliveredAt: '',
          recipientConfirmedAt: '',
          acceptedAt: '',
          pickedUpAt: '',
        }),
      ],
      OPTS
    );

    expect(file.subarray(0, 2).toString()).toBe('PK');
    expect(file.length).toBeGreaterThan(1000);
  });
});

describe('dashboardFileName', () => {
  it('names the file for the day it was taken, with the format as the extension', () => {
    expect(dashboardFileName('xlsx', NOW)).toBe('somoexpress-dashboard-2026-08-28.xlsx');
    expect(dashboardFileName('csv', NOW)).toBe('somoexpress-dashboard-2026-08-28.csv');
  });
});
