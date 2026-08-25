import { SkeletonBar, SkeletonCard, SkeletonField, SkeletonPane } from '@/components/Skeleton';

/**
 * Mirrors the real 1.15fr / 0.85fr split, so the form does not jump sideways
 * when the pricing rules and item categories arrive.
 */
export default function NewDeliveryLoading() {
  return (
    <SkeletonPane label="Loading the new delivery form">
      <div className="somo-grid">
        <div>
          <SkeletonCard title={104}>
            <SkeletonBar h={26} radius={3} style={{ marginBottom: 18 }} />
            <SkeletonField label={112} />
            <SkeletonField label={126} />
            <SkeletonField label={132} />
            <SkeletonField label={168} />
            <SkeletonField label={96} />
            <SkeletonField label={128} />
            <SkeletonField label={184} />
            <SkeletonField label={138} />
          </SkeletonCard>
        </div>

        <div>
          <SkeletonCard title={82} tagNote>
            <SkeletonField label={148} />
            <SkeletonField label={142} />
          </SkeletonCard>

          <SkeletonCard title={48} tagNote>
            <SkeletonBar h={92} radius={10} style={{ marginBottom: 18 }} />
            <SkeletonField label={176} />
            <SkeletonBar h={42} radius={8} />
          </SkeletonCard>
        </div>
      </div>
    </SkeletonPane>
  );
}
