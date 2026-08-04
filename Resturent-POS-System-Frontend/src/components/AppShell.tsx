import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import { NAV } from '../data/seed';
import type { NavEntry } from '../data/types';
import { CONFIG, usePos } from '../store';
import { canViewScreen } from '../lib/permissions';
import { CARD_SHADOW } from './ui';

export function AppShell({ children }: { children: ReactNode }) {
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
                {CONFIG.restaurantName}
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
