/**
 * Loading and motion primitives.
 *
 * ── What is animated, and what is not ──────────────────────────────────────
 * Two different jobs, deliberately done by two different mechanisms.
 *
 * The SKELETONS are CSS. A loading grid puts dozens of shimmering blocks on
 * screen at once, and a compositor-only background sweep costs nothing per
 * element — driving that from JavaScript would spend main-thread time on the
 * one screen that is already waiting on the network.
 *
 * The TRANSITIONS are motion. Entry, exit and layout changes need to know when
 * an element is leaving, which CSS cannot express: a row removed from an array
 * is gone from the DOM before any transition could run. `AnimatePresence` is
 * what makes a deleted row fade out rather than vanish.
 *
 * ── Everything here respects prefers-reduced-motion ────────────────────────
 * A POS runs for a whole shift in someone's peripheral vision. The durations
 * below are short on purpose, and the CSS media query in styles.css collapses
 * them to nothing for anyone who has asked for that.
 */
import { motion, AnimatePresence, type Transition } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';

export { motion, AnimatePresence };

/**
 * The house easing.
 *
 * 0.18s is long enough to read as movement and short enough that a cashier
 * tapping through twenty items never waits for it. Anything slower turns a
 * till into a toy.
 */
export const EASE: Transition = { duration: 0.18, ease: [0.4, 0, 0.2, 1] };

/** Content arriving: a short rise, matching the existing `riseIn` keyframe. */
export const fadeUp = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: EASE,
};

/**
 * A row joining or leaving a list.
 *
 * ── Why this does NOT animate height ───────────────────────────────────────
 * Animating `height: 0 -> auto` inside a scrolling flex column is a trap. The
 * animated value fights the column's own sizing: while it is mid-flight the
 * row reports a height that is not its natural one, flex redistributes the
 * remaining space against it, and a cart with several items ends up with rows
 * at visibly different heights — some squashed to nothing.
 *
 * Fading and a small slide read the same to a person and leave layout to the
 * browser. A row leaving still collapses, because `AnimatePresence` removes it
 * once the exit finishes and the column reflows normally.
 */
export const listRow = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97 },
  transition: EASE,
};

/** Screen and tab changes. A plain cross-fade — panels must not slide about. */
export const screenFade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.14 },
};

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

/**
 * One grey block standing in for content.
 *
 * Sized in the caller's own units so the placeholder occupies the space the
 * real content will — the point of a skeleton is that nothing jumps when the
 * data lands.
 */
export function Skeleton({
  width = '100%',
  height = 14,
  radius = 8,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className="skeleton"
      style={{ display: 'block', width, height, borderRadius: radius, ...style }}
    />
  );
}

/**
 * A grid of card placeholders — the menu grid, the table floor.
 *
 * `aria-busy` and a live-region label rather than silence: a screen reader
 * otherwise announces nothing at all while a screen loads, which is
 * indistinguishable from a screen that is broken.
 */
export function SkeletonGrid({
  count = 8,
  minWidth = 148,
  height = 170,
  gap = 12,
}: {
  count?: number;
  minWidth?: number;
  height?: number;
  gap?: number;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
        gap,
        alignContent: 'start',
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} radius={12} />
      ))}
    </div>
  );
}

/** Stacked row placeholders — customer lists, employee tables, report rows. */
export function SkeletonRows({
  count = 6,
  height = 56,
  gap = 8,
}: {
  count?: number;
  height?: number;
  gap?: number;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      style={{ display: 'flex', flexDirection: 'column', gap }}
    >
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} radius={10} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button feedback
// ---------------------------------------------------------------------------

/**
 * The spinner that replaces a button's icon while its request is in flight.
 *
 * `currentColor` so one component works on the green filled buttons and the
 * white outlined ones without being told which it is on.
 */
export function Spinner({ size = 15 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        border: '2px solid currentColor',
        borderTopColor: 'transparent',
        opacity: 0.9,
        animation: 'spin 0.7s linear infinite',
      }}
    />
  );
}

/**
 * A button's contents while it is working.
 *
 * Swaps the icon for a spinner and the label for a working message, and the
 * CALLER disables the button. Both matter: the spinner says the tap registered,
 * and the disable is what stops a second tap creating a second order. A
 * spinner without the disable is decoration.
 */
export function ButtonContent({
  busy,
  icon,
  busyLabel,
  children,
}: {
  busy: boolean;
  icon: ReactNode;
  busyLabel?: string;
  children: ReactNode;
}) {
  return (
    <>
      {busy ? <Spinner /> : icon}
      {busy && busyLabel ? busyLabel : children}
    </>
  );
}
