import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import { useIsMobile } from '../lib/useViewport';

export const CARD_SHADOW = '0 0 0.5px rgba(0,0,0,0.14), 0 1px 1px rgba(0,0,0,0.24)';
export const POP_SHADOW = '0 0 6px rgba(0,0,0,0.24), 0 8px 12px rgba(0,0,0,0.14)';

export const card: CSSProperties = {
  background: '#ffffff',
  borderRadius: 12,
  boxShadow: CARD_SHADOW,
};

/** Screen title block shared by every main pane. */
export function PageHeading({
  title,
  subtitle,
  right,
  wrap = false,
}: {
  title: string;
  subtitle: string;
  right?: ReactNode;
  wrap?: boolean;
}) {
  const isMobile = useIsMobile();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: isMobile ? 'stretch' : 'flex-end',
        justifyContent: 'space-between',
        gap: isMobile ? 10 : 16,
        // Always wrap on a phone regardless of what the caller asked for: the
        // alternative is a title and an action button sharing 347px, which
        // truncates one of them every time.
        flexWrap: wrap || isMobile ? 'wrap' : 'nowrap',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            margin: 0,
            fontSize: isMobile ? 20 : 24,
            fontWeight: 700,
            color: '#006241',
            lineHeight: 1.2,
          }}
        >
          {title}
        </h1>
        <p
          style={{
            margin: '6px 0 0',
            fontSize: isMobile ? 13 : 14,
            fontWeight: 500,
            color: 'rgba(0,0,0,0.58)',
          }}
        >
          {subtitle}
        </p>
      </div>
      {right}
    </div>
  );
}

/** Filter pill used by category tabs, zone tabs, kitchen type filters and report tabs. */
export function FilterPill({
  label,
  active,
  onClick,
  padding = '8px 18px',
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  padding?: string;
}) {
  return (
    <button
      type="button"
      className="press"
      onClick={onClick}
      style={{
        padding,
        borderRadius: 50,
        fontSize: 14,
        fontWeight: 600,
        background: active ? '#00754A' : '#ffffff',
        color: active ? '#ffffff' : 'rgba(0,0,0,0.58)',
        border: `1px solid ${active ? '#00754A' : '#d6dbde'}`,
        // Hold shape rather than being squeezed. In a nowrap row (the billing
        // category strip) this is what makes the row scroll instead of
        // compressing every pill into an unreadable sliver; in the wrapping
        // rows elsewhere it stops a long label being crushed or broken
        // mid-word. Both are improvements, so this is safe for every consumer.
        flexShrink: 0,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

export function SearchInput({
  placeholder,
  value,
  onChange,
  style,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  style?: CSSProperties;
}) {
  return (
    <div style={{ position: 'relative', ...style }}>
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
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '11px 14px 11px 38px',
          borderRadius: 50,
          border: '1px solid #d6dbde',
          background: '#f9f9f9',
          fontSize: 14,
          outline: 'none',
        }}
      />
    </div>
  );
}

/** Bordered box with a small uppercase caption above the control. */
export function Field({
  label,
  htmlFor,
  children,
  borderColor = '#d6dbde',
  labelColor = 'rgba(0,0,0,0.58)',
  style,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  borderColor?: string;
  labelColor?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        padding: '9px 16px 11px',
        ...style,
      }}
    >
      <label
        htmlFor={htmlFor}
        style={{
          display: 'block',
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: labelColor,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export const bareInput: CSSProperties = {
  width: '100%',
  marginTop: 4,
  border: 0,
  padding: 0,
  fontSize: 15,
  fontWeight: 600,
  background: 'transparent',
  outline: 'none',
};

/** Pill-shaped switch: 32x18 track with a sliding 14px knob. */
export function Toggle({ on }: { on: boolean }) {
  return (
    <span
      style={{
        position: 'relative',
        width: 32,
        height: 18,
        borderRadius: 50,
        flexShrink: 0,
        transition: 'background 0.2s ease',
        background: on ? '#00754A' : '#d6dbde',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#ffffff',
          transition: 'left 0.2s ease',
        }}
      />
    </span>
  );
}

/**
 * First-load and failure state for a screen backed by the API.
 *
 * Renders nothing once data has arrived, so a screen can drop it in above its
 * content without branching. The distinction that matters is between "still
 * loading" and "loaded and genuinely empty" — showing "No items" while a
 * request is still in flight reads as a broken menu, and a cashier will go
 * looking for a problem that does not exist.
 */
export function LoadState({
  loading,
  error,
  empty,
  emptyMessage,
  onRetry,
}: {
  loading: boolean;
  error: string;
  empty?: boolean;
  emptyMessage?: string;
  onRetry?: () => void;
}) {
  if (loading) {
    return (
      <p style={noticeStyle}>
        <span
          aria-hidden
          style={{
            width: 15,
            height: 15,
            borderRadius: '50%',
            border: '2px solid rgba(0,117,74,0.18)',
            borderTopColor: '#00754A',
            animation: 'spin 0.7s linear infinite',
          }}
        />
        Loading…
      </p>
    );
  }

  if (error) {
    return (
      <p style={{ ...noticeStyle, color: '#c82014' }}>
        {error}
        {onRetry ? (
          <button
            type="button"
            className="press"
            onClick={onRetry}
            style={{
              padding: '5px 14px',
              borderRadius: 50,
              border: '1px solid #c82014',
              background: 'transparent',
              color: '#c82014',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Try again
          </button>
        ) : null}
      </p>
    );
  }

  if (empty) return <p style={noticeStyle}>{emptyMessage ?? 'Nothing here yet.'}</p>;

  return null;
}

const noticeStyle: CSSProperties = {
  margin: 0,
  padding: '18px 0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  fontSize: 14,
  fontWeight: 500,
  color: 'rgba(0,0,0,0.58)',
};

export function ErrorLine({ message }: { message: string }) {
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13,
        fontWeight: 600,
        color: '#c82014',
      }}
    >
      <Icon icon="lucide:alert-circle" size={15} />
      {message}
    </span>
  );
}

export function ModalOverlay({
  children,
  maxWidth,
  scroll = false,
  gap = 14,
}: {
  children: ReactNode;
  maxWidth: number;
  scroll?: boolean;
  gap?: number;
}) {
  const isMobile = useIsMobile();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        // Bottom-anchored on a phone: a dialog that rises from the edge is
        // both the platform convention and the half that a thumb can reach.
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 24,
        overflowY: scroll ? 'auto' : undefined,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: isMobile ? '100%' : maxWidth,
          background: '#ffffff',
          borderRadius: isMobile ? '18px 18px 0 0' : 12,
          boxShadow: POP_SHADOW,
          padding: isMobile ? '20px 16px' : 24,
          paddingBottom: isMobile ? 'calc(20px + env(safe-area-inset-bottom))' : 24,
          display: 'flex',
          flexDirection: 'column',
          gap,
          animation: 'riseIn 0.2s ease-out',
          /*
           * Every dialog scrolls itself, whether or not the caller asked.
           * The employee form is taller than a phone in landscape, and without
           * this its Save button sits below the fold with no way to reach it —
           * the backdrop scrolls, the panel does not.
           */
          maxHeight: isMobile ? '92dvh' : 'calc(100dvh - 48px)',
          overflowY: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalTitle({ children }: { children: ReactNode }) {
  return (
    <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
      {children}
    </h2>
  );
}

export function ModalActions({
  onCancel,
  onSave,
  saveLabel = 'Save',
  destructive = false,
}: {
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
  destructive?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 2 }}>
      <button type="button" className="press hv-neutral" onClick={onCancel} style={cancelButton}>
        Cancel
      </button>
      <button
        type="button"
        className={`press ${destructive ? 'hv-danger-fill' : 'hv-primary'}`}
        onClick={onSave}
        style={destructive ? deleteButton : saveButton}
      >
        {saveLabel}
      </button>
    </div>
  );
}

const cancelButton: CSSProperties = {
  padding: '11px 22px',
  borderRadius: 50,
  border: '1px solid #d6dbde',
  background: '#ffffff',
  color: 'rgba(0,0,0,0.87)',
  fontSize: 14,
  fontWeight: 700,
};

const saveButton: CSSProperties = {
  padding: '11px 26px',
  borderRadius: 50,
  border: '1px solid #00754A',
  background: '#00754A',
  color: '#ffffff',
  fontSize: 14,
  fontWeight: 700,
};

const deleteButton: CSSProperties = { ...saveButton, border: '1px solid #c82014', background: '#c82014' };

/** Circular 28px icon button used for edit/delete affordances on cards and rows. */
/**
 * Round icon button.
 *
 * Grows on touch instead of relying on a global minimum height: the width has
 * to grow with the height or the circle becomes an oval, which is what a
 * blanket `min-height` rule did to every one of these.
 */
export function IconButton({
  icon,
  title,
  onClick,
  danger = false,
  size = 28,
  iconSize = 13,
}: {
  icon: string;
  title: string;
  onClick: (event: React.MouseEvent) => void;
  danger?: boolean;
  size?: number;
  iconSize?: number;
}) {
  const isMobile = useIsMobile();
  // 40px is the smallest target either platform's guidance accepts, and a
  // caller asking for something bigger already knows what it wants.
  const touchSize = isMobile ? Math.max(size, 40) : size;
  const glyph = isMobile ? Math.max(iconSize, 16) : iconSize;

  return (
    <button
      type="button"
      className={`press ${danger ? 'hv-danger' : 'hv-green'}`}
      title={title}
      onClick={onClick}
      style={{
        // Square, always — the two must not diverge or the radius stops
        // describing a circle.
        width: touchSize,
        height: touchSize,
        minHeight: touchSize,
        borderRadius: '50%',
        border: '1px solid #d6dbde',
        background: '#ffffff',
        color: 'rgba(0,0,0,0.58)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Icon icon={icon} size={glyph} />
    </button>
  );
}

export const primaryPill: CSSProperties = {
  padding: '11px 20px',
  borderRadius: 50,
  border: '1px solid #00754A',
  background: '#00754A',
  color: '#ffffff',
  fontSize: 14,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  gap: 7,
};

export const outlinePill: CSSProperties = {
  padding: '12px 20px',
  borderRadius: 50,
  border: '1px solid #d6dbde',
  background: '#ffffff',
  color: 'rgba(0,0,0,0.87)',
  fontSize: 14,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

export const tableHeaderCell: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'rgba(0,0,0,0.45)',
};

export function StatusBadge({ bg, fg, label }: { bg: string; fg: string; label: string }) {
  return (
    <span
      style={{
        justifySelf: 'start',
        fontSize: 11,
        fontWeight: 700,
        padding: '4px 12px',
        borderRadius: 50,
        background: bg,
        color: fg,
      }}
    >
      {label}
    </span>
  );
}
