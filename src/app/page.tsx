import { redirect } from 'next/navigation';
import { getSessionClaims } from '@/lib/auth';

export default async function Home() {
  const claims = await getSessionClaims();
  redirect(claims ? '/dashboard' : '/login');
}
