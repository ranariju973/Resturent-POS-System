import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import { NAV } from '../data/seed';
import type { NavEntry } from '../data/types';
import { usePos } from '../store';
import { canViewScreen } from '../lib/permissions';
import { useIsMobile } from '../lib/useViewport';
import { CARD_SHADOW } from './ui';

/**
 * The app frame: a sidebar on desktop, a floating tab bar on a phone.
 *
 * These are two different trees rather than one tree that reflows, because a
 * 240px sidebar has nowhere to go on a 375px screen — collapsing it to icons
 * still costs a fifth of the width, and a drawer hides the one control a
 * cashier uses constantly. Phones get the pattern they already know from every
 * other app on the device: a pill along the bottom, inside thumb reach.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return useIsMobile() ? <MobileShell>{children}</MobileShell> : <DesktopShell>{children}</DesktopShell>;
}

function DesktopShell({ children }: { children: ReactNode }) {
  const { state, actions } = usePos();
  const collapsed = state.collapsed;
  const expanded = !collapsed;
  const user = state.user!;

  const visible = useMemo(
    () => NAV.filter((entry) => canViewScreen(user.permissions, entry.id)),
    [user.permissions],
  );
  const ops = visible.filter((n) => n.group === 'ops');
  const mgmt = visible.filter((n) => n.group === 'mgmt');

  return (
    <div style={{ height: '100%', display: 'flex' }}>
      <aside
        style={{
          position: 'relative',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: '#ffffff',
          boxShadow: CARD_SHADOW,
          transition: 'width 220ms ease',
          width: collapsed ? 72 : 240,
        }}
      >
        <button
          type="button"
          className="press hv-green-chip"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => actions.shell({ collapsed: !collapsed })}
          style={{
            position: 'absolute',
            top: 26,
            right: -14,
            zIndex: 5,
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: '1px solid #d6dbde',
            background: '#ffffff',
            color: '#00754A',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 6px rgba(0,0,0,0.14)',
          }}
        >
          <Icon icon={collapsed ? 'lucide:chevron-right' : 'lucide:chevron-left'} size={15} />
        </button>

        <div
          style={{
            padding: '20px 16px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: '#00754A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              flexShrink: 0,
            }}
          >
            <Icon icon="lucide:coffee" size={21} />
          </span>
          {expanded ? (
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ fontSize: 17, fontWeight: 700, color: '#006241' }}>
                {state.restaurant?.name ?? 'Restaurant POS'}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)' }}>
                Point of Sale
              </span>
            </span>
          ) : null}
        </div>

        <div
          style={{
            padding: '0 16px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            overflow: 'hidden',
          }}
        >
          <img
            src={user.avatar}
            alt={user.name}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              objectFit: 'cover',
              display: 'block',
              border: '2px solid #d4e9e2',
              flexShrink: 0,
            }}
          />
          {expanded ? (
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                alignItems: 'flex-start',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                {user.name}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: '#00754A',
                  background: '#d4e9e2',
                  padding: '2px 8px',
                  borderRadius: 50,
                }}
              >
                {user.role}
              </span>
            </span>
          ) : null}
        </div>

        {/* Nav deliberately never scrolls: collapsed tooltips must escape the sidebar. */}
        <nav
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'visible',
            padding: '0 12px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {/* Entries the session cannot open are omitted, not disabled — a
              greyed-out "Reports" still tells a cashier the screen exists and
              invites them to go looking. The server enforces regardless. */}
          {ops.length > 0 ? (
            <>
              <GroupLabel collapsed={collapsed} label="Operations" first />
              {ops.map((entry) => (
                <NavRow key={entry.id} entry={entry} />
              ))}
            </>
          ) : null}
          {mgmt.length > 0 ? (
            <>
              <GroupLabel collapsed={collapsed} label="Management" first={ops.length === 0} />
              {mgmt.map((entry) => (
                <NavRow key={entry.id} entry={entry} />
              ))}
            </>
          ) : null}
        </nav>

        <div style={{ flexShrink: 0, borderTop: '1px solid #edebe9', padding: 12 }}>
          <button
            type="button"
            className="press hv-danger-row"
            title="Log out"
            onClick={actions.logout}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              border: 0,
              borderRadius: 12,
              background: 'transparent',
              color: 'rgba(0,0,0,0.58)',
              fontSize: 14,
              fontWeight: 600,
              justifyContent: collapsed ? 'center' : 'flex-start',
              overflow: 'hidden',
            }}
          >
            <Icon icon="lucide:log-out" size={19} />
            {expanded ? <span style={{ whiteSpace: 'nowrap' }}>Log out</span> : null}
          </button>
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            padding: '12px 24px',
            background: '#ffffff',
            boxShadow:
              '0 1px 3px rgba(0,0,0,0.1), 0 2px 2px rgba(0,0,0,0.06), 0 0 2px rgba(0,0,0,0.07)',
          }}
        >
          <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
            <span
              style={{
                position: 'absolute',
                left: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'rgba(0,0,0,0.45)',
                display: 'flex',
              }}
            >
              <Icon icon="lucide:search" />
            </span>
            <input
              type="text"
              className="focus-green-lift"
              placeholder="Search orders, tables, menu items"
              style={{
                width: '100%',
                padding: '10px 14px 10px 38px',
                borderRadius: 50,
                border: '1px solid #d6dbde',
                background: '#f9f9f9',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="press hv-green"
              onClick={actions.logout}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px 8px 8px',
                borderRadius: 50,
                border: '1px solid #d6dbde',
                background: '#ffffff',
                fontSize: 13,
                fontWeight: 700,
                color: 'rgba(0,0,0,0.87)',
              }}
            >
              <img
                src={user.avatar}
                alt={user.name}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  display: 'block',
                }}
              />
              {user.name} · {user.role}
              <Icon icon="lucide:repeat-2" size={15} color="rgba(0,0,0,0.45)" />
            </button>
            <button
              type="button"
              className="press hv-danger"
              title="Log out"
              onClick={actions.logout}
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                border: '1px solid #d6dbde',
                background: '#ffffff',
                color: 'rgba(0,0,0,0.58)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon icon="lucide:log-out" size={17} />
            </button>
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}

function GroupLabel({
  collapsed,
  label,
  first = false,
}: {
  collapsed: boolean;
  label: string;
  first?: boolean;
}) {
  if (collapsed) {
    return <span style={{ height: 1, background: '#edebe9', margin: '10px 8px 6px' }} />;
  }
  return (
    <p
      style={{
        margin: first ? '8px 12px 4px' : '16px 12px 4px',
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.09em',
        color: 'rgba(0,0,0,0.38)',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </p>
  );
}

function NavRow({ entry }: { entry: NavEntry }) {
  const { state, actions } = usePos();
  const collapsed = state.collapsed;
  const active = state.active === entry.id;
  const tipOpen = collapsed && state.hover === entry.id;

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="press hv-var"
        aria-label={entry.label}
        aria-current={active ? 'page' : undefined}
        onClick={() => actions.shell({ active: entry.id })}
        onMouseEnter={() => actions.patch({ hover: entry.id })}
        onMouseLeave={() => actions.patch({ hover: '' })}
        style={
          {
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 12px',
            border: 0,
            borderRadius: 12,
            fontSize: 14,
            fontWeight: active ? 700 : 500,
            background: active ? '#d4e9e2' : 'transparent',
            color: active ? '#1E3932' : 'rgba(0,0,0,0.58)',
            justifyContent: collapsed ? 'center' : 'flex-start',
            overflow: 'hidden',
            '--hover-bg': active ? '#d4e9e2' : '#f9f9f9',
          } as CSSProperties
        }
      >
        <Icon icon={entry.icon} size={19} color={active ? '#00754A' : 'rgba(0,0,0,0.45)'} />
        {!collapsed ? <span style={{ whiteSpace: 'nowrap' }}>{entry.label}</span> : null}
      </button>
      {tipOpen ? (
        <span
          style={{
            position: 'absolute',
            left: 'calc(100% + 14px)',
            top: '50%',
            zIndex: 20,
            padding: '7px 13px',
            borderRadius: 50,
            background: '#1E3932',
            color: '#ffffff',
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            boxShadow: '0 0 6px rgba(0,0,0,0.24)',
            animation: 'tipIn 0.15s ease-out',
            pointerEvents: 'none',
          }}
        >
          {entry.label}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------------

/** Tabs that fit across a phone before the rest go behind "More". */
const MAX_TABS = 5;

function MobileShell({ children }: { children: ReactNode }) {
  const { state, actions } = usePos();
  const user = state.user!;
  const [moreOpen, setMoreOpen] = useState(false);

  const visible = useMemo(
    () => NAV.filter((entry) => canViewScreen(user.permissions, entry.id)),
    [user.permissions],
  );

  // With five or fewer everything fits and there is no overflow menu. Beyond
  // that the last slot becomes "More", so four tabs plus it — an admin holding
  // all eight screens still reaches every one of them in two taps.
  const overflows = visible.length > MAX_TABS;
  const tabs = overflows ? visible.slice(0, MAX_TABS - 1) : visible;
  const rest = overflows ? visible.slice(MAX_TABS - 1) : [];
  const restIsActive = rest.some((entry) => entry.id === state.active);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          paddingTop: 'calc(10px + env(safe-area-inset-top))',
          background: '#ffffff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1), 0 0 2px rgba(0,0,0,0.07)',
        }}
      >
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: '#00754A',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
            flexShrink: 0,
          }}
        >
          <Icon icon="lucide:coffee" size={18} />
        </span>

        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, minWidth: 0 }}>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: '#006241',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {state.restaurant?.name ?? 'Restaurant POS'}
          </span>
          {/* The role, not the screen name — the screen is obvious from the
              highlighted tab, but who is signed in at a shared till is not. */}
          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.45)' }}>
            {user.name} · {user.role}
          </span>
        </span>

        <button
          type="button"
          className="press hv-danger"
          title="Log out"
          onClick={actions.logout}
          style={{
            marginLeft: 'auto',
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: '1px solid #d6dbde',
            background: '#ffffff',
            color: 'rgba(0,0,0,0.58)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon icon="lucide:log-out" size={16} />
        </button>
      </header>

      {/*
        The screens render their own <main> with `flex: 1; minHeight: 0`, so
        this only has to be a flex parent that lets them scroll. The bottom
        padding clears the floating bar — without it the last row of every
        list sits permanently underneath it.
      */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: 'calc(80px + env(safe-area-inset-bottom))',
        }}
      >
        {children}
      </div>

      <nav
        aria-label="Sections"
        style={{
          position: 'fixed',
          left: 12,
          right: 12,
          bottom: 'calc(12px + env(safe-area-inset-bottom))',
          zIndex: 40,
          height: 62,
          /*
           * A true capsule: the radius is half the height, so the ends are
           * semicircles rather than the rounded-off corners a smaller radius
           * gives. This is the shape the platform bars use.
           */
          borderRadius: 999,
          /*
           * Frosted rather than solid. Content scrolling underneath stays
           * faintly visible, which is what stops a floating bar reading as a
           * slab stuck on top of the page. `saturate` keeps the colour behind
           * it from going grey, the way iOS does it.
           */
          background:
            typeof CSS !== 'undefined' && CSS.supports?.('backdrop-filter: blur(1px)')
              ? 'rgba(255,255,255,0.82)'
              : '#ffffff',
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          border: '1px solid rgba(0,0,0,0.06)',
          // Two shadows: a tight one to seat it, a wide soft one to lift it.
          boxShadow: '0 1px 2px rgba(0,0,0,0.08), 0 8px 28px rgba(0,0,0,0.16)',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: 6,
        }}
      >
        {tabs.map((entry) => (
          <TabButton
            key={entry.id}
            icon={entry.icon}
            label={entry.short}
            fullLabel={entry.label}
            active={state.active === entry.id}
            onClick={() => {
              setMoreOpen(false);
              actions.shell({ active: entry.id });
            }}
          />
        ))}

        {overflows ? (
          <TabButton
            icon="lucide:chevron-up"
            label="More"
            // Lit while one of the hidden screens is open, so the bar never
            // shows nothing selected.
            active={moreOpen || restIsActive}
            onClick={() => setMoreOpen((open) => !open)}
          />
        ) : null}
      </nav>

      {moreOpen ? (
        <MoreSheet
          entries={rest}
          activeId={state.active}
          onPick={(id) => {
            setMoreOpen(false);
            actions.shell({ active: id });
          }}
          onClose={() => setMoreOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * One tab. The active state is a filled pill behind the icon and label, which
 * is the shape every phone OS uses for this — recognisable without a legend,
 * and large enough to be a thumb target rather than a pixel-hunt.
 */
function TabButton({
  icon,
  label,
  fullLabel,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  fullLabel?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="press"
      // The visible text is abbreviated, so the accessible name is not.
      aria-label={fullLabel ?? label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: 0,
        height: 50,
        border: 0,
        // The selected tab is a capsule inside a capsule — same radius rule
        // as the bar, so the highlight echoes the shape holding it rather
        // than cutting a rectangle out of it.
        borderRadius: 999,
        background: active ? '#00754A' : 'transparent',
        color: active ? '#ffffff' : 'rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        padding: '0 2px',
        transition: 'background 0.18s ease, color 0.18s ease',
      }}
    >
      {/*
        Fixed box around the glyph. Without it the icon's own height varies
        between glyphs and the labels below them sit at different heights,
        which is what made the row look ragged.
      */}
      <span
        style={{
          height: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon icon={icon} size={20} color={active ? '#ffffff' : 'rgba(0,0,0,0.5)'} />
      </span>
      <span
        style={{
          fontSize: 10,
          lineHeight: 1,
          fontWeight: active ? 800 : 600,
          letterSpacing: '-0.01em',
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </button>
  );
}

/** The overflow menu, as a bottom sheet — it rises from the bar it belongs to. */
function MoreSheet({
  entries,
  activeId,
  onPick,
  onClose,
}: {
  entries: NavEntry[];
  activeId: string;
  onPick: (id: NavEntry['id']) => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 45,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          background: '#ffffff',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          padding: 16,
          paddingBottom: 'calc(92px + env(safe-area-inset-bottom))',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          animation: 'riseIn 0.2s ease-out',
          maxHeight: '70vh',
          overflowY: 'auto',
        }}
      >
        <span
          style={{
            alignSelf: 'center',
            width: 38,
            height: 4,
            borderRadius: 50,
            background: '#d6dbde',
            marginBottom: 8,
          }}
        />
        {entries.map((entry) => {
          const active = entry.id === activeId;
          return (
            <button
              key={entry.id}
              type="button"
              className="press hv-var"
              onClick={() => onPick(entry.id)}
              style={
                {
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '13px 14px',
                  border: 0,
                  borderRadius: 14,
                  textAlign: 'left',
                  background: active ? '#d4e9e2' : 'transparent',
                  color: active ? '#1E3932' : 'rgba(0,0,0,0.87)',
                  fontSize: 15,
                  fontWeight: active ? 700 : 600,
                  '--hover-bg': active ? '#d4e9e2' : '#f9f9f9',
                } as CSSProperties
              }
            >
              <Icon icon={entry.icon} size={20} color={active ? '#00754A' : 'rgba(0,0,0,0.45)'} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                {entry.label}
                <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}>
                  {entry.blurb}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
