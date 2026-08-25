import { SkeletonBar, SkeletonCard, SkeletonFieldPair, SkeletonPane } from '@/components/Skeleton';

export default function RidersLoading() {
  return (
    <SkeletonPane label="Loading the rider roster">
      <SkeletonCard title={102} tagNote style={{ marginTop: 0 }}>
        <SkeletonFieldPair />
        <SkeletonFieldPair />
        <SkeletonBar w={112} h={34} radius={8} />

        <div className="somo-riders-grid" style={{ marginTop: 18 }}>
          {Array.from({ length: 4 }, (_, i) => (
            <div className="somo-rider-card" key={i}>
              <div style={{ flex: 1 }}>
                <SkeletonBar w={i % 2 === 0 ? 128 : 104} h={12} />
                <SkeletonBar w={92} h={10} style={{ marginTop: 7 }} />
                <SkeletonBar w={148} h={10} style={{ marginTop: 5 }} />
              </div>
              <SkeletonBar w={96} h={28} radius={6} />
            </div>
          ))}
        </div>
      </SkeletonCard>
    </SkeletonPane>
  );
}
