import { redirect } from 'next/navigation';

// proxy.ts already bounces anonymous visitors to /login, so anyone landing
// here has a valid session cookie.
export default function Home() {
  redirect('/portal/new');
}
