import { redirect } from 'next/navigation';

// proxy.ts already bounces anonymous visitors to /login, so anyone landing
// here has a valid session cookie. Via /portal rather than straight to the
// dashboard, so this route keeps agreeing with the portal index.
export default function Home() {
  redirect('/portal');
}
