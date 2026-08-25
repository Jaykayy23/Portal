import {
  SkeletonCard,
  SkeletonPane,
  SkeletonTable,
  SkeletonTiles,
  SkeletonToolbar,
} from '@/components/Skeleton';

/**
 * The heaviest tab: deliveries, settlement marks, settlements and the merchant
 * roster are all read before the first position can be derived.
 */
export default function LedgerLoading() {
  return (
    <SkeletonPane label="Loading the ledger">
      <SkeletonCard title={144} tagNote style={{ marginTop: 0 }}>
        <SkeletonToolbar count={3} />
        <SkeletonTiles count={6} />
      </SkeletonCard>

      <div className="somo-split">
        <SkeletonCard title={84} tagNote>
          <SkeletonTable rows={3} cols={4} />
        </SkeletonCard>
        <SkeletonCard title={126} tagNote>
          <SkeletonTable rows={3} cols={4} />
        </SkeletonCard>
      </div>

      <SkeletonCard title={62} tagNote>
        <SkeletonToolbar count={4} />
        <SkeletonTable rows={8} cols={8} />
      </SkeletonCard>
    </SkeletonPane>
  );
}
