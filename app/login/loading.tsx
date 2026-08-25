import { SkeletonBar } from '@/components/Skeleton';

/**
 * The login screen reads the branding table on every request so a freshly
 * uploaded logo appears at once, which means it has a server round trip before
 * the card can paint. This holds the card's shape while that happens.
 */
export default function LoginLoading() {
  return (
    <main className="somo-auth-overlay" id="main-content" role="status" aria-busy="true">
      <span className="sr-only">Loading the sign-in screen</span>
      <div className="somo-auth-card" aria-hidden="true">
        <div className="somo-auth-logo">
          <SkeletonBar w={34} h={34} radius={9} />
          <div style={{ flex: 1 }}>
            <SkeletonBar w={112} h={15} />
            <SkeletonBar w={148} h={10} style={{ marginTop: 6 }} />
          </div>
        </div>
        <SkeletonBar w={82} h={22} style={{ marginBottom: 22 }} />
        <SkeletonBar w={72} h={9} style={{ marginBottom: 6 }} />
        <SkeletonBar h={40} radius={8} style={{ marginBottom: 14 }} />
        <SkeletonBar w={68} h={9} style={{ marginBottom: 6 }} />
        <SkeletonBar h={40} radius={8} style={{ marginBottom: 14 }} />
        <SkeletonBar h={44} radius={8} />
      </div>
    </main>
  );
}
