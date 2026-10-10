'use client';

import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowRight, Box, Eye, EyeOff} from 'lucide-react';
import {api, departments} from '@/lib/api';
import {authHref, safeReturnPath} from '@/lib/auth-navigation';
import {useApp, ErrorMessage} from './shell';

export function AuthForm({signup = false}: {signup?: boolean}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [next, setNext] = useState('/workspace');
  const pending = useRef(false);
  const errorSummary = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const {refresh} = useApp();

  useEffect(() => { setNext(safeReturnPath(new URLSearchParams(window.location.search).get('next'))); }, []);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (signup && String(values.name).trim().length < 2) {
      setError('Enter your full name using at least 2 characters.');
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await api(`/auth/${signup ? 'signup' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          email: String(values.email).trim(),
          ...(signup ? {name: String(values.name).trim(), semester: Number(values.semester)} : {}),
        }),
      });
      await refresh();
      router.replace(safeReturnPath(new URLSearchParams(window.location.search).get('next')));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <div className="auth-layout">
    <div className="auth-story" aria-hidden="true">
      <Box size={40}/><p className="auth-story-title">Your next big idea<br/>belongs here.</p>
      <p>A place for the things you build, the problems you solve, and the people who inspire you.</p>
      <div className="auth-story-bottom">Made for curious minds.<br/><strong>Built by students.</strong></div>
    </div>
    <section className="auth-panel" aria-labelledby="auth-title">
      <h1 id="auth-title">{signup ? 'Make room for your ideas.' : 'Welcome back.'}</h1>
      <p>{signup ? 'Create your student account to start sharing.' : 'Sign in and pick up where you left off.'}</p>
      <form onSubmit={submit} aria-busy={busy}>
        <div ref={errorSummary} tabIndex={-1} className="form-error-summary"><ErrorMessage id="auth-error" message={error}/></div>
        <fieldset className="form-fields" disabled={busy}>
          {signup && <label>Full name<input name="name" autoComplete="name" required minLength={2} maxLength={80} placeholder="Your name"/></label>}
          <label>Email address<input name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} placeholder="you@college.edu"/></label>
          <label htmlFor="auth-password">Password</label>
          <div className="password-field">
            <input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 10 : 1} maxLength={128} aria-describedby={signup ? 'password-requirements' : undefined} placeholder={signup ? 'Create a password' : 'Enter your password'}/>
            <button type="button" className="icon-button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} aria-controls="auth-password" onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}</button>
          </div>
          {signup && <p className="field-hint" id="password-requirements">Use 10–128 characters. You can paste a password from your password manager.</p>}
          {signup && <div className="form-grid">
            <label>Department<select name="department" required defaultValue=""><option value="" disabled>Choose department</option>{departments.map(department => <option key={department}>{department}</option>)}</select></label>
            <label>Semester<select name="semester" required defaultValue=""><option value="" disabled>Choose semester</option>{Array.from({length: 12}, (_, index) => <option key={index} value={index + 1}>Semester {index + 1}</option>)}</select></label>
          </div>}
          <button className="button primary full" type="submit" disabled={busy}>{busy ? signup ? 'Creating your account…' : 'Signing in…' : signup ? 'Create account' : 'Sign in'}<ArrowRight size={18} aria-hidden="true"/></button>
        </fieldset>
      </form>
      <div className="auth-switch">{signup ? 'Already have an account?' : 'New to ProjectHub?'} <Link href={authHref(!signup, next)}>{signup ? 'Sign in' : 'Create an account'}</Link></div>
      <p className="auth-note">Faculty and admin access is assigned by your administrator.</p>
    </section>
  </div>;
}
