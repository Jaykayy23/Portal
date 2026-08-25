import { SkeletonBar, SkeletonCard, SkeletonField, SkeletonPane } from '@/components/Skeleton';

/** Branding spans the row; the two feature cards sit beside it on a wide screen. */
export default function SettingsLoading() {
  return (
    <SkeletonPane label="Loading portal settings">
      <div className="somo-settings-grid">
        <SkeletonCard title={82} className="span-full" style={{ marginTop: 0 }}>
          <div className="somo-logo-row">
            <SkeletonBar w={56} h={56} radius={10} />
            <div style={{ flex: 1 }}>
              <SkeletonBar h={38} radius={8} />
            </div>
          </div>
          <SkeletonBar w={214} h={34} radius={8} style={{ marginTop: 14 }} />
        </SkeletonCard>

        <SkeletonCard title={112} tagNote>
          <SkeletonBar h={38} radius={8} />
          <SkeletonBar h={38} radius={8} style={{ marginTop: 10 }} />
          <SkeletonBar w={168} h={34} radius={8} style={{ marginTop: 14 }} />
        </SkeletonCard>

        <SkeletonCard title={74} tagNote>
          <SkeletonField label={244} />
          <SkeletonField label={196} />
          <SkeletonField label={132} />
        </SkeletonCard>
      </div>
    </SkeletonPane>
  );
}
