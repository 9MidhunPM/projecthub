import './dom-setup';
import assert from 'node:assert/strict';
import {useState} from 'react';
import {afterEach, test} from 'node:test';
import {act, cleanup, fireEvent, render, waitFor} from '@testing-library/react';
import {ScreenshotEditor} from '../components/screenshot-editor';
import {deferred} from './component-helpers';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

function Screenshots() {
  const [images, setImages] = useState(['/one.webp', '/two.webp', '/three.webp']);
  return <ScreenshotEditor screenshots={images} onChange={setImages} onUploadingChange={() => {}} disabled={false}/>;
}

test('reordering preserves the moved screenshot identity and keyboard focus', () => {
  const view = render(<Screenshots/>);
  const thirdEarlier = view.getByRole('button', {name: 'Move screenshot 3 earlier'});
  thirdEarlier.focus();
  fireEvent.click(thirdEarlier);
  const movedEarlier = view.getByRole('button', {name: 'Move screenshot 2 earlier'});
  assert.ok(movedEarlier === thirdEarlier, 'The moved screenshot should keep its button node.');
  assert.ok(document.activeElement === movedEarlier, 'Keyboard focus should follow the moved image.');
  assert.deepEqual(view.getAllByRole('img').map(image => image.getAttribute('src')), ['/one.webp', '/three.webp', '/two.webp']);
});

test('moving into the cover position focuses an available ordering control', () => {
  const view = render(<Screenshots/>);
  const secondEarlier = view.getByRole('button', {name: 'Move screenshot 2 earlier'});
  secondEarlier.focus();
  fireEvent.click(secondEarlier);
  assert.ok(document.activeElement === view.getByRole('button', {name: 'Move screenshot 1 later'}), 'An enabled ordering control should receive focus at the boundary.');
  assert.ok(view.getByRole('button', {name: 'Move screenshot 1 earlier'}).hasAttribute('disabled'));
});


function UploadHarness({onUploadingChange = () => {}}: {onUploadingChange?: (busy: boolean) => void}) {
  const [images, setImages] = useState<string[]>([]);
  return <ScreenshotEditor screenshots={images} onChange={setImages} onUploadingChange={onUploadingChange} disabled={false}/>;
}

function uploadFile(name: string, type = 'image/png') {
  return new File(['local-test-image'], name, {type});
}

test('invalid multi-file selections are rejected before any valid file is uploaded', async () => {
  let uploads = 0;
  globalThis.fetch = async () => { uploads += 1; return Response.json({url: '/one.webp'}); };
  const view = render(<UploadHarness/>);
  fireEvent.change(view.getByLabelText('Choose screenshots'), {target: {files: [uploadFile('valid.png'), uploadFile('notes.txt', 'text/plain')]}});
  await waitFor(() => assert.match(view.getByRole('alert').textContent ?? '', /notes.txt/));
  assert.equal(uploads, 0);
  assert.equal(view.queryAllByRole('img').length, 0);
});

test('partial upload failures preserve completed images and retry only the remaining files', async () => {
  const names: string[] = [];
  const busy: boolean[] = [];
  globalThis.fetch = async (_url, options) => {
    const file = (options?.body as FormData).get('file') as File;
    names.push(file.name);
    if (names.length === 2) return new Response('{}', {status: 503});
    return Response.json({url: `/${file.name}.webp`});
  };
  const view = render(<UploadHarness onUploadingChange={value => busy.push(value)}/>);
  fireEvent.change(view.getByLabelText('Choose screenshots'), {target: {files: [uploadFile('one'), uploadFile('two'), uploadFile('three')]}});
  await waitFor(() => assert.ok(view.getByRole('button', {name: 'Retry 2 remaining screenshots'})));
  assert.match(view.getByRole('alert').textContent ?? '', /1 of 3 screenshots added/);
  assert.deepEqual(view.getAllByRole('img').map(image => image.getAttribute('src')), ['/one.webp']);
  assert.equal(view.getByLabelText('Choose screenshots').hasAttribute('disabled'), false);
  fireEvent.click(view.getByRole('button', {name: 'Retry 2 remaining screenshots'}));
  await waitFor(() => assert.equal(view.getAllByRole('img').length, 3));
  assert.deepEqual(names, ['one', 'two', 'two', 'three']);
  assert.deepEqual(busy, [true, false, true, false]);
  assert.equal(view.queryByRole('alert'), null);
  assert.equal(view.queryByRole('button', {name: /Retry/}), null);
});

test('unmount aborts upload transport and suppresses late image or progress callbacks', async () => {
  const response = deferred<Response>();
  const changes: unknown[] = [];
  const busy: boolean[] = [];
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_url, options) => { signal = options?.signal; return response.promise; };
  const view = render(<ScreenshotEditor screenshots={[]} onChange={value => changes.push(value)} onUploadingChange={value => busy.push(value)} disabled={false}/>);
  fireEvent.change(view.getByLabelText('Choose screenshots'), {target: {files: [uploadFile('one')]}});
  assert.deepEqual(busy, [true]);
  view.unmount();
  assert.equal(signal?.aborted, true);
  await act(async () => response.resolve(Response.json({url: '/one.webp'})));
  assert.deepEqual(changes, []);
  assert.deepEqual(busy, [true]);
});
