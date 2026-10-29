import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// A maioria dos testes roda no jsdom; alguns (ex.: no-emoji) rodam em Node puro, sem DOM.
const hasDom = typeof window !== 'undefined';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (hasDom) {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  }
});

// matchMedia não existe no jsdom
if (hasDom) {
  window.matchMedia =
    window.matchMedia ||
    ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
}
