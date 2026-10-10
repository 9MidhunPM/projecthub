import './dom-setup';
import assert from 'node:assert/strict';
import {useState} from 'react';
import {afterEach, test} from 'node:test';
import {cleanup, fireEvent, render} from '@testing-library/react';
import {ScreenshotEditor} from '../components/screenshot-editor';

afterEach(cleanup);

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
