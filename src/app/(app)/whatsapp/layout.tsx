import WhatsAppFrame from '@/components/whatsapp/WhatsAppFrame';

export const metadata = { title: 'WhatsApp' };

export default function WhatsAppLayout({ children }: LayoutProps<'/whatsapp'>) {
  return <WhatsAppFrame>{children}</WhatsAppFrame>;
}
