/**
 * Viewport size, as a hook.
 *
 * ── Why a hook and not CSS media queries ───────────────────────────────────
 * This app styles with inline objects, not classes — there is no stylesheet to
 * hang a `@media` block on for most of what needs to change. More importantly,
 * mobile here is not a matter of narrower columns: the billing screen has to
 * swap a two-pane desktop layout for a single pane with a slide-up cart, and
 * the shell swaps a sidebar for a bottom bar. Those are different component
 * trees, not different widths, and a media query cannot choose between them.
 *
 * So the breakpoint is a value the components can branch on. One resize
 * listener, shared by every consumer through the same hook.
 */
import { useEffect, useState } from 'react';

/**
 * Phones, portrait and landscape. 768 is the conventional tablet floor: an
 * iPad in portrait is 768 and gets the desktop layout, which it has the room
 * for; every phone falls below it.
 */
export const MOBILE_MAX = 767;

/** Tablets and small laptops — desktop layout, but not room for everything. */
export const TABLET_MAX = 1023;

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

function read(): Breakpoint {
  // Guard for the server-render case; the app is client-only today, but a
  // window reference at module scope is the kind of thing that breaks a build
  // long after anyone remembers why.
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  if (w <= MOBILE_MAX) return 'mobile';
  if (w <= TABLET_MAX) return 'tablet';
  return 'desktop';
}

/**
 * The current breakpoint, updated on resize and orientation change.
 *
 * State holds the breakpoint NAME rather than the pixel width on purpose:
 * dragging a desktop window from 1400px to 1200px would otherwise re-render
 * every subscriber on every frame for a change nothing renders differently.
 */
export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(read);

  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      // Coalesce to one read per frame — a resize drag fires this continuously,
      // and each read forces a layout.
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setBreakpoint(read()));
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return breakpoint;
}

/** Shorthand for the common branch. */
export function useIsMobile(): boolean {
  return useBreakpoint() === 'mobile';
}

/** True on phones AND tablets — for things that only fit a real desktop. */
export function useIsCompact(): boolean {
  return useBreakpoint() !== 'desktop';
}
