import { SkeletonBar, SkeletonCard, SkeletonField, SkeletonFieldPair, SkeletonPane } from '@/components/Skeleton';

export default function PricingLoading() {
  return (
    <SkeletonPane label="Loading the pricing rules">
      <SkeletonCard title={152} tagNote style={{ marginTop: 0, maxWidth: 480 }}>
        <SkeletonFieldPair />
        <SkeletonFieldPair />
        <SkeletonField label={218} />
        <SkeletonBar w={186} h={40} radius={8} style={{ marginTop: 6 }} />
      </SkeletonCard>

      <SkeletonCard title={108} tagNote style={{ maxWidth: 480 }}>
        <SkeletonBar h={40} radius={8} />
        <SkeletonBar h={40} radius={8} style={{ marginTop: 10 }} />
        <SkeletonBar w={162} h={34} radius={8} style={{ marginTop: 14 }} />
      </SkeletonCard>
    </SkeletonPane>
  );
}
