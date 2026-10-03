import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const key of Reflect.ownKeys(dom.window)) {
  if (!(key in globalThis) && !['window', 'document', 'navigator'].includes(String(key))) {
    const descriptor = Object.getOwnPropertyDescriptor(dom.window, key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  }
}
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true, writable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
