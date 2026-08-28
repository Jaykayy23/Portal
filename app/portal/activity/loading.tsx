import { SkeletonCard, SkeletonPane, SkeletonTable, SkeletonToolbar } from '@/components/Skeleton';

/**
 * One card, one filter row, one table. Lighter than the ledger's because this
 * tab reads a single page of one indexed table plus the account list for the
 * dropdown — nothing is summed and nothing is joined.
 */
export default function ActivityLoading() {
  return (
    <SkeletonPane label="Loading the activity log">
      <SkeletonCard title={78} tagNote style={{ marginTop: 0 }}>
        <SkeletonToolbar count={4} />
        <SkeletonTable rows={10} cols={3} />
      </SkeletonCard>
    </SkeletonPane>
  );
}
