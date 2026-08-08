/**
 * App Bridge custom elements.
 *
 * `ui-nav-menu` is defined at runtime by the App Bridge script loaded in layout.tsx, so
 * TypeScript has no way to know it exists — React's JSX namespace only knows the standard
 * HTML elements. Declaring it here is what lets the navigation menu be written as ordinary
 * JSX rather than assembled with `document.createElement` or cast away with `any`.
 *
 * Deliberately narrow: only the element actually used is declared, so the next custom
 * element someone reaches for is still a compile error rather than silently accepted.
 */
import type React from 'react';

declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        'ui-nav-menu': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      }
    }
  }
}

export {};
