import './dom-setup';
import assert from 'node:assert/strict';
import {useState} from 'react';
import {afterEach, test} from 'node:test';
import {act, cleanup, fireEvent, render, waitFor} from '@testing-library/react';
import {ScreenshotEditor} from '../components/screenshot-editor';
import {Moderation} from '../components/moderation';
import {Bookmarks} from '../components/workspace';
import {useApp} from '../components/shell';
import {deferred, listing, project, renderApp, student} from './component-helpers';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; window.history.replaceState({}, '', '/'); });

function Images({initial}: {initial: string[]}) {
  const [images, setImages] = useState(initial);
  return <><input aria-label="Other field"/><ScreenshotEditor screenshots={images} onChange={setImages} onUploadingChange={() => {}} disabled={false}/></>;
}
for (const [count, remove, destination] of [[3, 1, 'Remove screenshot 1'], [3, 3, 'Remove screenshot 2'], [1, 1, 'Choose screenshots']] as const) test(`removing screenshot ${remove} of ${count} focuses the nearest surviving control`, () => {
  const view = render(<Images initial={Array.from({length: count}, (_, index) => `/${index}.webp`)}/>);
  const button = view.getByRole('button', {name: `Remove screenshot ${remove}`});
  button.focus(); fireEvent.click(button);
  assert.ok(document.activeElement === view.getByLabelText(destination));
});
test('screenshot removal does not steal focus from another field', () => {
  const view = render(<Images initial={['/one.webp', '/two.webp']}/>);
  const field = view.getByLabelText('Other field');
  field.focus(); fireEvent.click(view.getByRole('button', {name: 'Remove screenshot 1'}));
  assert.ok(document.activeElement === field);
});

for (const review of [false, true]) for (const moved of [false, true]) test(`${review ? 'review' : 'bookmark'} removal ${moved ? 'respects a newer focus target' : 'recovers focus through refill failure'}`, async () => {
  const mutation = deferred<Response>();
  let removed = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) return Response.json(review ? {...student, id: 'faculty-1', role: 'FACULTY'} : student);
    if (options?.method === (review ? 'PATCH' : 'DELETE')) { const response = await mutation.promise; removed = true; return response; }
    if (removed) return Response.json({message: 'Refill failed'}, {status: 503});
    return Response.json(listing([{...project, status: review ? 'PENDING' : 'APPROVED', bookmarked: true}]));
  };
  const view = renderApp(<><input aria-label="Other field"/>{review ? <Moderation/> : <Bookmarks/>}</>, review ? '/moderation' : '/bookmarks');
  await waitFor(() => assert.ok(view.getByRole('button', {name: review ? 'Request changes' : `Unsave ${project.title}`})));
  if (review) fireEvent.change(view.getByLabelText('Feedback for the student'), {target: {value: 'Please clarify the setup instructions.'}});
  const action = view.getByRole('button', {name: review ? 'Request changes' : `Unsave ${project.title}`});
  action.focus(); fireEvent.click(action);
  // Some browsers blur controls when they become disabled. Preserve that focus
  // ownership, but never override an explicit move to another control.
  if (moved) view.getByLabelText('Other field').focus(); else action.blur();
  await act(async () => mutation.resolve(Response.json(review ? {...project, status: 'CHANGES_REQUESTED'} : {likes: 0, liked: false, bookmarked: false})));
  await waitFor(() => assert.ok(view.getByText('Refill failed')));
  const expected = moved ? view.getByLabelText('Other field') : view.getByRole('heading', {level: 1, name: review ? 'Give good work a green light.' : 'Saved inspiration'});
  assert.ok(document.activeElement === expected);
});

function Notification({removeTrigger = false}: {removeTrigger?: boolean}) {
  const {notify} = useApp();
  const [visible, setVisible] = useState(true);
  return <><input aria-label="Other field"/>{visible && <button onClick={() => { notify('Saved successfully'); if (removeTrigger) setVisible(false); }}>Show test notification</button>}</>;
}
for (const removeTrigger of [false, true]) test(`toast dismissal restores ${removeTrigger ? 'main content when its origin is gone' : 'the surviving origin control'}`, async () => {
  globalThis.fetch = async () => Response.json(student);
  const view = renderApp(<Notification removeTrigger={removeTrigger}/>);
  await waitFor(() => assert.ok(view.getByRole('link', {name: `Your profile, ${student.name}`})));
  const trigger = view.getByRole('button', {name: 'Show test notification'});
  trigger.focus(); fireEvent.click(trigger);
  const dismiss = view.getByRole('button', {name: 'Dismiss notification'});
  act(() => dismiss.focus()); fireEvent.click(dismiss);
  assert.ok(document.activeElement === (removeTrigger ? view.getByRole('main') : trigger));
});

test('toast expiration pauses while its dismiss button has focus and resumes after leaving', async () => {
  const timeout = window.setTimeout;
  const clearTimeout = window.clearTimeout;
  const timers = new Map<number, () => void>();
  let sequence = 10000;
  window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === 6000 && typeof callback === 'function') { timers.set(++sequence, () => callback(...args)); return sequence; }
    return timeout(callback, delay, ...args);
  }) as typeof window.setTimeout;
  window.clearTimeout = ((id?: number) => { if (id && timers.has(id)) timers.delete(id); else clearTimeout(id); }) as typeof window.clearTimeout;
  try {
    globalThis.fetch = async () => Response.json(student);
    const view = renderApp(<Notification/>);
    await waitFor(() => assert.ok(view.getByRole('link', {name: `Your profile, ${student.name}`})));
    fireEvent.click(view.getByRole('button', {name: 'Show test notification'}));
    assert.equal(timers.size, 1);
    const dismiss = view.getByRole('button', {name: 'Dismiss notification'});
    act(() => dismiss.focus());
    assert.equal(timers.size, 0, 'focused notifications must not expire');
    assert.ok(document.activeElement === dismiss);
    const other = view.getByLabelText('Other field');
    act(() => other.focus());
    assert.equal(timers.size, 1, 'expiration resumes after focus leaves');
    act(() => [...timers.values()][0]());
    assert.ok(view.queryByRole('button', {name: 'Dismiss notification'}) === null);
    assert.ok(document.activeElement === other);
  } finally { window.setTimeout = timeout; window.clearTimeout = clearTimeout; }
});

test('a review completed after history navigation does not move focus in the replacement page', async () => {
  const mutation = deferred<Response>();
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) return Response.json({...student, id: 'faculty-1', role: 'FACULTY'});
    if (options?.method === 'PATCH') return mutation.promise;
    const page = Number(new URL(String(url), 'http://localhost:3000').searchParams.get('page'));
    return Response.json(listing([{...project, id: `project-${page}`, title: `Review ${page}`, status: 'PENDING'}], 13, page));
  };
  const view = renderApp(<Moderation/>, '/moderation');
  await waitFor(() => assert.ok(view.getByRole('button', {name: 'Request changes'})));
  fireEvent.change(view.getByLabelText('Feedback for the student'), {target: {value: 'Please clarify the setup instructions.'}});
  const action = view.getByRole('button', {name: 'Request changes'});
  action.focus(); fireEvent.click(action);
  act(() => { window.history.pushState({}, '', '/moderation?page=2'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await waitFor(() => assert.ok(view.getByRole('heading', {name: 'Review 2'})));
  assert.ok(document.activeElement === document.body);
  await act(async () => mutation.resolve(Response.json({...project, status: 'CHANGES_REQUESTED'})));
  assert.ok(document.activeElement === document.body, 'the removed old action no longer owns focus');
});
