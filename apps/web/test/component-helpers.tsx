import type {ReactNode} from 'react';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {PathnameContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import {render} from '@testing-library/react';
import {AppProvider} from '../components/shell';
import type {Project, User} from '../lib/api';

export const student: User = {id: 'student-1', name: 'A Student', email: 'student@example.test', role: 'STUDENT', department: 'Computer Science', semester: 2};
export const project: Project = {id: 'project-1', title: 'Campus ideas', description: 'A useful student project with a clear description.', department: 'Computer Science', semester: 2, type: 'Web Application', techStack: ['React'], teamMembers: ['A Student'], screenshots: [], status: 'APPROVED', version: 1, views: 1, createdAt: '2026-10-10T10:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z', ownerId: student.id, owner: {id: student.id, name: student.name, department: student.department, semester: student.semester}, likes: 0, liked: false, bookmarked: false};

export function renderApp(children: ReactNode, path = '/') {
  const navigation: {method: 'push' | 'replace'; href: string}[] = [];
  const router = {back() {}, forward() {}, refresh() {}, hmrRefresh() {}, prefetch: async () => {}, push: (href: string) => { navigation.push({method: 'push', href}); }, replace: (href: string) => { navigation.push({method: 'replace', href}); }};
  return {...render(<AppRouterContext.Provider value={router}><PathnameContext.Provider value={path}><AppProvider>{children}</AppProvider></PathnameContext.Provider></AppRouterContext.Provider>), navigation};
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return {promise, resolve, reject};
}
