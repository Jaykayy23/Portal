import { SkeletonCard, SkeletonPane, SkeletonTable, SkeletonToolbar } from '@/components/Skeleton';

/** One card holding the search toolbar and the log table. */
export default function DeliveryLogLoading() {
  return (
    <SkeletonPane label="Loading the delivery log">
      <SkeletonCard title={124} tagNote style={{ marginTop: 0 }}>
        <SkeletonToolbar count={4} />
        <SkeletonTable rows={9} cols={7} />
      </SkeletonCard>
    </SkeletonPane>
  );
}
