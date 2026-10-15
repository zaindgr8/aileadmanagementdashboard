import { redirect } from 'next/navigation';
import AppShell from '@/components/shell/AppShell';
import { currentUser } from '@/lib/auth/current';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await currentUser();
  if (!user) redirect('/login');
  return <AppShell user={user}>{children}</AppShell>;
}
