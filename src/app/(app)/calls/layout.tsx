import { DashboardProvider, TooltipProvider } from '@/components/voice/dashboard-context';
import { CallsFrame } from '@/components/voice/shell';

export const metadata = { title: 'Voice calls' };

export default function CallsLayout({ children }: LayoutProps<'/calls'>) {
  return (
    <DashboardProvider>
      <TooltipProvider>
        <CallsFrame>{children}</CallsFrame>
      </TooltipProvider>
    </DashboardProvider>
  );
}
