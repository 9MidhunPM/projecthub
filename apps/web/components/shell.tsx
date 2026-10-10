'use client';

import Link from 'next/link';
import {usePathname, useRouter} from 'next/navigation';
import {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';
import {Box, Plus, Menu, X, LogOut} from 'lucide-react';
import {api, ApiError, User, initials, isAbortError} from '@/lib/api';

type Context = {
  user: User | null;
  loading: boolean;
  sessionError: string;
  refresh: () => Promise<void>;
  notify: (text: string) => void;
};

const AppContext = createContext<Context>({user: null, loading: true, sessionError: '', refresh: async () => {}, notify: () => {}});
export const useApp = () => useContext(AppContext);

export function AppProvider({children}: {children: React.ReactNode}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [toast, setToast] = useState('');
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const logoutPending = useRef(false);
  const mounted = useRef(true);
  const sessionGeneration = useRef(0);
  const sessionRequest = useRef<AbortController | null>(null);
  const logoutRequest = useRef<AbortController | null>(null);
  const header = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const path = usePathname();
  const router = useRouter();

  const refresh = useCallback(async () => {
    if (!mounted.current || logoutPending.current) return;
    sessionRequest.current?.abort();
    const controller = new AbortController();
    const generation = ++sessionGeneration.current;
    sessionRequest.current = controller;
    const current = () => mounted.current && sessionGeneration.current === generation && !controller.signal.aborted;
    setLoading(true);
    setSessionError('');
    try {
      const nextUser = await api<User>('/auth/me', {signal: controller.signal});
      if (current()) setUser(nextUser);
    } catch (failure) {
      if (!current() || isAbortError(failure)) return;
      if (failure instanceof ApiError && failure.status === 401) {
        setUser(null);
      } else {
        setSessionError((failure as Error).message);
      }
    } finally {
      if (current()) { sessionRequest.current = null; setLoading(false); }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      sessionGeneration.current += 1;
      sessionRequest.current?.abort();
      logoutRequest.current?.abort();
    };
  }, [refresh]);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); menuButton.current?.focus(); }
    };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOutside);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOutside);
    };
  }, [open]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function logout() {
    if (logoutPending.current) return;
    logoutPending.current = true;
    // A response issued before logout must never resurrect the old session.
    sessionGeneration.current += 1;
    sessionRequest.current?.abort();
    sessionRequest.current = null;
    const controller = new AbortController();
    logoutRequest.current = controller;
    setLoading(false);
    setSigningOut(true);
    try {
      await api('/auth/logout', {method: 'POST', signal: controller.signal});
      if (!mounted.current || controller.signal.aborted) return;
      setUser(null);
      setSessionError('');
      setOpen(false);
      setToast('You have signed out.');
      router.push('/');
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted && !isAbortError(failure)) setToast((failure as Error).message);
    } finally {
      logoutPending.current = false;
      logoutRequest.current = null;
      if (mounted.current) setSigningOut(false);
    }
  }

  const links = [
    {href: '/', label: 'Explore', active: path === '/'},
    {href: '/workspace', label: 'My workspace', active: path.startsWith('/workspace')},
    {href: '/bookmarks', label: 'Bookmarks', active: path === '/bookmarks'},
    ...(user && user.role !== 'STUDENT' ? [{href: '/moderation', label: 'Review', active: path === '/moderation'}] : []),
    ...(user?.role === 'ADMIN' ? [{href: '/admin', label: 'Admin', active: path === '/admin'}] : []),
  ];
  const shareHref = user ? '/projects/new' : '/login?next=%2Fprojects%2Fnew';

  return <AppContext.Provider value={{user, loading, sessionError, refresh, notify: setToast}}>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header ref={header} className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="ProjectHub home"><Box size={27} strokeWidth={2.6} aria-hidden="true"/><span>ProjectHub</span></Link>
        <button ref={menuButton} className="icon-button mobile-toggle" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-controls="main-navigation" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X aria-hidden="true"/> : <Menu aria-hidden="true"/>}</button>
        <nav id="main-navigation" className={open ? 'main-nav open' : 'main-nav'} aria-label="Main navigation">
          {links.map(link => <Link key={link.href} className={link.active ? 'active' : ''} aria-current={link.active ? 'page' : undefined} href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}
          <Link className="mobile-nav-action" href={shareHref} onClick={() => setOpen(false)}><Plus size={17} aria-hidden="true"/>Share a project</Link>
          {user && <button className="mobile-nav-action" disabled={signingOut} onClick={logout}><LogOut size={17} aria-hidden="true"/>{signingOut ? 'Signing out…' : 'Sign out'}</button>}
        </nav>
        <div className="header-actions">
          {user ? <>
            <Link className="avatar" aria-label={`Your profile, ${user.name}`} href="/profile">{initials(user.name)}</Link>
            <button className="icon-button logout" aria-label={signingOut ? 'Signing out' : 'Sign out'} title="Sign out" disabled={signingOut} onClick={logout}><LogOut size={18} aria-hidden="true"/></button>
          </> : loading ? <span className="session-loading" role="status"><span className="sr-only">Checking your session…</span></span> : <Link className="sign-in" href="/login">Sign in</Link>}
          <Link className="button primary compact" aria-label="Share a project" href={shareHref}><Plus size={16} aria-hidden="true"/><span>Share a project</span></Link>
        </div>
      </div>
    </header>
    <main id="main-content" tabIndex={-1}>{children}</main>
    <footer className="footer"><Link className="brand" href="/"><Box size={21} aria-hidden="true"/><span>ProjectHub</span></Link><span>A home for student work.</span><span className="footer-end">Ideas deserve a place to grow.</span></footer>
    {toast && <div className="toast" role="status" aria-live="polite"><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={16} aria-hidden="true"/></button></div>}
  </AppContext.Provider>;
}

export function Guard({children, roles}: {children: React.ReactNode; roles?: User['role'][]}) {
  const {user, loading, sessionError, refresh} = useApp();
  const path = usePathname();
  if (loading && !user) return <Loading/>;
  if (sessionError && !user) return <div className="empty"><h1>We couldn’t check your session.</h1><ErrorMessage message={sessionError}/><button className="button primary" onClick={() => void refresh()}>Try again</button></div>;
  if (!user) return <div className="auth-required"><Box size={42} aria-hidden="true"/><h1>A space for your next idea.</h1><p>Sign in to share projects, save inspiration, and manage your work.</p><Link className="button primary" href={`/login?next=${encodeURIComponent(path)}`}>Sign in to continue</Link><Link className="text-link" href={`/signup?next=${encodeURIComponent(path)}`}>New here? Create an account</Link></div>;
  if (roles && !roles.includes(user.role)) return <div className="empty"><h1>This space needs a different role.</h1><p>Your account does not have permission to view this page.</p><Link href="/workspace" className="button">Back to workspace</Link></div>;
  return <>{children}</>;
}

export function Loading({message = 'Loading your space…'}: {message?: string}) {
  return <div className="loading" role="status"><span className="spinner" aria-hidden="true"/>{message}</div>;
}

export function ErrorMessage({message, id}: {message: string; id?: string}) {
  return message ? <div id={id} role="alert" className="error-message">{message}</div> : null;
}
