import {
  SkeletonBar,
  SkeletonCard,
  SkeletonPane,
  SkeletonTable,
  SkeletonTiles,
  SkeletonToolbar,
} from '@/components/Skeleton';

/**
 * The dashboard counts every delivery row the viewer is allowed to see before it
 * can render a single figure, so it is the slowest tab on a wide account.
 */
export default function DashboardLoading() {
  return (
    <SkeletonPane label="Loading the delivery dashboard">
      <SkeletonCard title={148} tagNote style={{ marginTop: 0 }}>
        <SkeletonToolbar count={2} />
        <SkeletonTiles count={8} />
      </SkeletonCard>

      <SkeletonCard title={96} tagNote>
        <SkeletonBar h={168} radius={8} />
      </SkeletonCard>

      <div className="somo-split">
        <SkeletonCard title={84} tagNote>
          <SkeletonTable rows={4} cols={4} />
        </SkeletonCard>
        <SkeletonCard title={112} tagNote>
          <SkeletonTable rows={4} cols={4} />
        </SkeletonCard>
      </div>
    </SkeletonPane>
  );
}
