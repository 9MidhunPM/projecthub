import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost:3000/', pretendToBeVisual: true});
const browser = dom.window;

for (const name of ['window', 'self', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'PopStateEvent', 'SubmitEvent', 'File', 'FileList', 'FormData', 'MutationObserver', 'getComputedStyle'] as const) {
  Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: name === 'window' || name === 'self' ? browser : browser[name]});
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {configurable: true, writable: true, value: true});
browser.HTMLElement.prototype.scrollIntoView = () => {};
browser.scrollTo = () => {};
