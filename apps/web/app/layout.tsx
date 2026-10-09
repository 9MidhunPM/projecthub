import type { Metadata } from 'next';
import './globals.css';
import { AppProvider } from '@/components/shell';
export const metadata: Metadata = {title:'ProjectHub · A home for student work',description:'Discover, share and archive student projects.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><AppProvider>{children}</AppProvider></body></html>}
