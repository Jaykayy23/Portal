import { SkeletonBar, SkeletonCard, SkeletonField, SkeletonFieldPair, SkeletonPane } from '@/components/Skeleton';

export default function AccountsLoading() {
  return (
    <SkeletonPane label="Loading accounts">
      <SkeletonCard title={132} tagNote style={{ marginTop: 0 }}>
        <SkeletonFieldPair />
        <SkeletonFieldPair />
        <SkeletonField label={148} />
        <SkeletonBar w={142} h={34} radius={8} />
      </SkeletonCard>

      <SkeletonCard title={128}>
        {Array.from({ length: 4 }, (_, i) => (
          <div className="somo-account-card" key={i} style={i > 0 ? { marginTop: 10 } : undefined}>
            <div style={{ flex: 1 }}>
              <SkeletonBar w={i % 2 === 0 ? 146 : 118} h={12} />
              <SkeletonBar w={184} h={10} style={{ marginTop: 7 }} />
            </div>
            <SkeletonBar w={112} h={28} radius={6} />
          </div>
        ))}
      </SkeletonCard>
    </SkeletonPane>
  );
}
