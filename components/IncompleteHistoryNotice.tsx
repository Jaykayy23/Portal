import { DELIVERY_HISTORY_DAYS } from '@/lib/deliveries';

interface Props {
  /** The delivery history hit its ceiling: older rows are missing entirely. */
  deliveries?: boolean;
  /** The settlement book hit its ceiling: settled rows may read as unsettled. */
  marks?: boolean;
  /** How many rows the screen is actually working from. */
  loaded: number;
}

/**
 * Said out loud when a screen is working from part of the history.
 *
 * Every figure on the ledger, the dashboard and the rider float list is a sum
 * over the rows that were loaded. While that is the whole window the sums are
 * the truth; past the ceiling they quietly become a floor, and a floor labelled
 * "Past 365 days" is worse than no figure at all — it is a wrong number nobody
 * has any reason to doubt.
 *
 * Two different lies are possible and they point opposite ways, so they are
 * worded separately rather than merged into one vague warning: missing
 * deliveries hide debts, and missing settlement marks invent them.
 */
export function IncompleteHistoryNotice({ deliveries, marks, loaded }: Props) {
  if (!deliveries && !marks) return null;

  return (
    <div className="somo-incomplete" role="status">
      <strong>These figures cover part of the period, not all of it.</strong>
      <ul>
        {deliveries ? (
          <li>
            The newest {loaded.toLocaleString()} deliveries loaded, which is less than the
            past {DELIVERY_HISTORY_DAYS} days. Anything older is missing, so outstanding
            balances are <em>at least</em> what is shown here — not the total.
          </li>
        ) : null}
        {marks ? (
          <li>
            Some settlement records could not be loaded. A delivery whose settlement is
            missing reads as unpaid, so a row may appear owed when it has already been
            handed in — check the settlement history before chasing anyone for it.
          </li>
        ) : null}
      </ul>
      <span>
        Narrow the date range to get exact figures, and tell an administrator: this
        install has outgrown loading its history in one go.
      </span>
    </div>
  );
}
