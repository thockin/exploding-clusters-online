import 'bootstrap/dist/css/bootstrap.min.css';
import { SocketProvider } from './contexts/SocketContext';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <SocketProvider>{children}</SocketProvider>
      </body>
    </html>
  );
}