import { useMemo, useState, type CSSProperties } from 'react';
import { Icon } from '../icons/Icon';
import { CONFIG, SHOW_ALL, usePos } from '../store';
import type { OrderType } from '../data/types';
import { CURRENCY, money, plural } from '../lib/format';
import { useIsMobile } from '../lib/useViewport';
import { Spinner, SkeletonGrid, motion, AnimatePresence, listRow } from '../components/motion';
import type { ReactNode } from 'react';
import {
  CARD_SHADOW,
  POP_SHADOW,
  FilterPill,
  LoadState,
  PageHeading,
  SearchInput,
} from '../components/ui';

/** Shared styling for the two customer inputs. */
const compactInput: CSSProperties = {
  width: '100%',
  marginTop: 2,
  border: 0,
  padding: 0,
  fontSize: 14,
  fontWeight: 600,
  color: 'rgba(0,0,0,0.87)',
  background: 'transparent',
  outline: 'none',
};

const ORDER_TYPES: { id: OrderType; label: string }[] = [
  { id: 'dine-in', label: 'Dine-in' },
  { id: 'takeaway', label: 'Takeaway' },
  { id: 'delivery', label: 'Delivery' },
];

export function Billing() {
  const { state, actions } = usePos();
  const isMobile = useIsMobile();

  /**
   * On a phone the cart is a sheet rather than a column — there is not room
   * for both it and the menu grid, and of the two the grid is what a cashier
   * is looking at while they take an order. The sheet is opened from a summary
   * bar that reports what is in it, so the cart is never out of mind, only out
   * of the way.
   */
  const [cartOpen, setCartOpen] = useState(false);

  const query = state.query.trim().toLowerCase();

  /**
   * ── Why these are Maps and not .find() ──────────────────────────────────
   * This screen re-renders on every keystroke in the search box, and every
   * patch() in the store replaces the whole state object, so "every render"
   * means most of them.
   *
   * qtyOf is called once per rendered product tile. Backed by cart.find() it
   * was a linear scan per tile — O(products × cart). lines did the same thing
   * in the other direction, an items.find() per cart line — O(cart × items).
   * On a 200-item menu with a 20-line cart that is roughly 4,000 comparisons
   * per keystroke, on the one screen a cashier uses all day.
   *
   * Building the index once per change makes each lookup a hash probe, so the
   * same work becomes O(products + cart).
   */
  const qtyById = useMemo(
    () => new Map(state.cart.map((l) => [l.id, l.qty])),
    [state.cart],
  );
  const qtyOf = (id: string) => qtyById.get(id) ?? 0;

  const itemById = useMemo(
    () => new Map(state.items.map((i) => [i.id, i])),
    [state.items],
  );

  const products = useMemo(
    () =>
      state.items.filter(
        (p) =>
          p.available &&
          (state.cat === SHOW_ALL || p.cat === state.cat) &&
          (!query || p.name.toLowerCase().includes(query)),
      ),
    [state.items, state.cat, query],
  );

  const lines = useMemo(
    () =>
      state.cart.flatMap((line) => {
        const item = itemById.get(line.id);
        return item ? [{ line, item, lineTotal: item.price * line.qty }] : [];
      }),
    [state.cart, itemById],
  );

  const open = state.activeOrder;

  // Before the bill is opened these are a local estimate so the cashier can see
  // the effect of a discount. Once it exists, every figure is the server's —
  // its rounding is the one that ends up on the receipt.
  const draftSubtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const rawDiscount = parseFloat(state.discountValue) || 0;
  const draftDiscount = Math.min(
    state.discountMode === 'pct' ? (draftSubtotal * rawDiscount) / 100 : rawDiscount,
    draftSubtotal,
  );

  const subtotal = open ? open.subtotal : draftSubtotal;
  const discount = open ? open.discount : draftDiscount;
  const total = open ? open.total : Math.max(draftSubtotal - draftDiscount, 0);

  const count = lines.reduce((sum, l) => sum + l.line.qty, 0);

  /*
   * ── The customer is optional ─────────────────────────────────────────────
   * A walk-in paying cash has no reason to hand over a phone number, and a
   * till that refuses to open their bill until they do does not collect better
   * data — it collects `000000` and `asdf`, typed by a cashier with a queue
   * waiting. An order with no customer is already a first-class thing here:
   * `Order.customer` is nullable, and the payload simply omits the field.
   *
   * What is still enforced is CONSISTENCY once someone starts filling it in,
   * because a half-entered customer is worse than none:
   *
   *   • a phone with fewer than 6 digits identifies nobody, and the server
   *     refuses it — better to say so under the field than after the tap;
   *   • a number the restaurant has never seen is refused without a name to
   *     file it under (see resolveInlineCustomer), deliberately, so the
   *     customer list does not fill up with "Guest";
   *   • a name typed with no phone would be silently dropped, since the phone
   *     is what identity is keyed on. Losing something a cashier typed is not
   *     an acceptable way to be permissive.
   */
  const phoneDigits = state.customerPhone.replace(/\D/g, '');
  // A customer picked from the list is attached by id, so the order carries no
  // digits and needs none. Counting characters in the masked display instead
  // would pass or fail on how long the number happens to be, which is not a
  // rule anyone intended.
  const phonePicked = state.customerPhoneMasked !== '';
  const phoneStarted = !state.customerId && phoneDigits.length > 0;
  const phoneTooShort = phoneStarted && phoneDigits.length < 6;
  const nameEntered = state.customer.trim().length > 0;

  // Only once a number is on the bill: with no customer at all, there is
  // nothing for a name to belong to.
  const nameMissing = phoneStarted && !state.customerKnown && state.customer.trim().length < 2;
  const nameOrphaned = !phoneStarted && !state.customerId && nameEntered;

  // Dine-in without a table is refused by the server, so the button must not
  // pretend otherwise.
  const tableMissing = state.orderType === 'dine-in' && !state.orderTable;

  const blocker =
    count === 0
      ? 'Add an item to bill'
      : phoneTooShort
        ? 'Phone needs at least 6 digits — or clear it'
        : nameMissing
          ? 'Name this new number, or clear the phone'
          : nameOrphaned
            ? 'Add a phone number, or clear the name'
            : tableMissing
              ? 'Pick a table for dine-in'
              : null;

  const canGenerate = !blocker && !state.checkoutPending;

  /**
   * Printing needs an order — either one that is open, or the one just
   * settled. A cart alone is not enough: nothing has an order number yet.
   */
  const printable = Boolean(state.activeOrder || state.lastPrintable);
  const printTitle = printable
    ? 'Print a thermal receipt'
    : state.cart.length > 0
      ? 'Open the bill first — the kitchen ticket is created with it'
      : 'Add items first';
  const tableName = state.tables.find((t) => t.id === state.orderTable)?.name ?? '';

  return (
    <main
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        gap: isMobile ? 0 : 24,
        padding: isMobile ? 14 : 24,
      }}
    >
      <section style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <PageHeading
          title="POS Billing"
          subtitle="Tap an item to add it to the order"
          right={
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.58)' }}>
              {plural(products.length, 'item')}
            </span>
          }
        />

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            background: '#ffffff',
            borderRadius: 12,
            padding: 16,
            boxShadow: CARD_SHADOW,
          }}
        >
          <SearchInput
            placeholder="Search in products"
            value={state.query}
            onChange={(query) => actions.patch({ query })}
          />

          {/*
            One row on every screen, scrolling sideways when it overflows.
            Wrapping made the strip two or three rows deep on a tablet, and
            every extra row came straight out of the product grid below it.
          */}
          <div
            className="scroll-x"
            style={{
              display: 'flex',
              flexWrap: 'nowrap',
              gap: 8,
              flexShrink: 0,
              paddingBottom: 4,
            }}
          >
            {[{ id: SHOW_ALL, name: 'Show All' }, ...state.cats].map((c) => (
              <FilterPill
                key={c.id}
                label={c.name}
                active={c.id === state.cat}
                onClick={() => actions.patch({ cat: c.id })}
              />
            ))}
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '2px 4px 4px 2px',
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 148 : 200}px, 1fr))`,
              gap: 16,
              alignContent: 'start',
            }}
          >
            {products.map((p) => {
              const qty = qtyOf(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className="press hv-green-border"
                  onClick={() => actions.addToCart(p.id)}
                  style={{
                    position: 'relative',
                    textAlign: 'left',
                    padding: 12,
                    borderRadius: 12,
                    border: '1px solid rgba(0,0,0,0.07)',
                    background: '#ffffff',
                    boxShadow: CARD_SHADOW,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  {/*
                    Square by aspect-ratio rather than a fixed pixel height, so
                    the tile stays square at every column width the grid picks.
                    objectFit keeps a non-square photo from stretching.
                  */}
                  <span
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1',
                      borderRadius: 10,
                      overflow: 'hidden',
                      background: '#edebe9',
                      display: 'block',
                    }}
                  >
                    {p.img ? (
                      <img
                        src={p.img}
                        alt={p.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <span
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'rgba(0,0,0,0.24)',
                        }}
                      >
                        <Icon icon="lucide:image-off" size={22} />
                      </span>
                    )}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'rgba(0,0,0,0.87)',
                        lineHeight: 1.3,
                      }}
                    >
                      {p.name}
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#00754A' }}>
                        {money(p.price)}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}>
                        {p.catName}
                      </span>
                    </span>
                  </span>
                  {qty > 0 ? (
                    <span
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        minWidth: 24,
                        height: 24,
                        padding: '0 7px',
                        borderRadius: 50,
                        background: '#00754A',
                        color: '#ffffff',
                        fontSize: 12,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 0 6px rgba(0,0,0,0.24)',
                        animation: 'badgePop 0.18s ease-out',
                      }}
                    >
                      {qty}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <LoadState
            loading={state.menuLoading}
            skeleton={<SkeletonGrid count={isMobile ? 6 : 10} minWidth={isMobile ? 148 : 200} />}
            error={state.menuError}
            empty={!state.menuLoading && !state.menuError && products.length === 0}
            emptyMessage={
              state.items.length === 0
                ? 'No menu items yet. Add them under Menu Management.'
                : 'No items match that search.'
            }
            onRetry={() => void actions.loadMenu()}
          />
        </div>
      </section>

      {/*
        The summary bar. Sits above the tab bar and reports what the sheet
        holds, so the cart is never hidden — only collapsed. Tapping it is the
        only way back in, which is why it is a full-width target rather than an
        icon.
      */}
      {isMobile && !cartOpen ? (
        <button
          type="button"
          className="press hv-primary"
          onClick={() => setCartOpen(true)}
          style={{
            position: 'fixed',
            left: 10,
            right: 10,
            bottom: 'calc(84px + env(safe-area-inset-bottom))',
            zIndex: 35,
            height: 52,
            padding: '0 18px',
            borderRadius: 50,
            border: 0,
            background: '#00754A',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            boxShadow: POP_SHADOW,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, fontWeight: 700 }}>
            <Icon icon="lucide:shopping-bag" size={17} color="#ffffff" />
            {count > 0 ? plural(count, 'item') : 'Order details'}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 800 }}>
            {count > 0 ? money(total) : ''}
            <Icon icon="lucide:chevron-up" size={16} color="#ffffff" />
          </span>
        </button>
      ) : null}

      {isMobile && cartOpen ? (
        <div
          onClick={() => setCartOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 48, background: 'rgba(0,0,0,0.45)' }}
        />
      ) : null}

      <aside
        style={
          isMobile
            ? {
                // A sheet, not a column. Stops short of the top so the screen
                // behind stays visible — this is a panel over the menu, not a
                // different place.
                position: 'fixed',
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 49,
                height: '90dvh',
                display: cartOpen ? 'flex' : 'none',
                flexDirection: 'column',
                background: '#ffffff',
                borderRadius: '18px 18px 0 0',
                boxShadow: POP_SHADOW,
                overflow: 'hidden',
                animation: 'riseIn 0.22s ease-out',
              }
            : {
                width: 400,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                background: '#ffffff',
                borderRadius: 12,
                boxShadow: CARD_SHADOW,
                overflow: 'hidden',
              }
        }
      >
        {isMobile ? (
          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              padding: '10px 14px 4px',
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 800, color: 'rgba(0,0,0,0.87)' }}>
              Current order
            </span>
            <button
              type="button"
              className="press hv-neutral"
              aria-label="Close cart"
              onClick={() => setCartOpen(false)}
              style={{
                width: 34,
                height: 34,
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
              <Icon icon="lucide:chevron-down" size={16} />
            </button>
          </div>
        ) : null}
        {/*
          Fixed header. `flexShrink: 0` is the fix for the bug this panel had:
          without it, flex chose the header as the thing to compress once the
          cart grew, so adding items visibly ate the customer fields — and the
          footer, which already had the guard, stayed put. Both ends are pinned
          now and only the cart scrolls.
        */}
        <div
          style={{
            flexShrink: 0,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            borderBottom: '1px solid #edebe9',
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            {ORDER_TYPES.map((type) => (
              <button
                key={type.id}
                type="button"
                className="press"
                onClick={() => actions.setOrderType(type.id)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 50,
                  border: `1px solid ${state.orderType === type.id ? '#00754A' : '#d6dbde'}`,
                  background: state.orderType === type.id ? '#00754A' : '#ffffff',
                  color: state.orderType === type.id ? '#ffffff' : 'rgba(0,0,0,0.58)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {type.label}
              </button>
            ))}
          </div>

          {/*
            One line, not a grid of buttons. The inline list pushed the cart
            down as soon as dine-in was chosen, which is the thing that made
            the selected items hard to see. The choice happens in an overlay.
          */}
          {state.orderType === 'dine-in' ? (
            <button
              type="button"
              className="press"
              onClick={actions.openTablePicker}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                width: '100%',
                padding: '9px 12px',
                borderRadius: 10,
                border: `1px solid ${state.orderTable ? '#00754A' : '#cba258'}`,
                background: state.orderTable ? '#d4e9e2' : '#f8ecd2',
                color: state.orderTable ? '#1E3932' : '#6b4f12',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Icon icon="lucide:utensils" size={14} />
                {tableName ? `Table ${tableName}` : 'Choose a table'}
              </span>
              <Icon icon="lucide:chevron-right" size={15} />
            </button>
          ) : null}

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
              <FieldShell
                label="Phone"
                warn={phoneTooShort}
                tint={phonePicked}
                hint={
                  state.customerLookupThrottled
                    ? 'lookup paused'
                    : state.customerLookupPending
                      ? 'checking…'
                      : phonePicked
                        ? 'attached'
                        : // Said on the field itself, not only in the button's
                          // blocker text — a cashier should be able to see that
                          // it can be skipped without first trying to skip it.
                          phoneStarted
                          ? ''
                          : 'optional'
                }
              >
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="98200 41122"
                  // The masked form when a customer was picked, the typed
                  // digits otherwise. Read-only while masked: the bullets are
                  // not a number, so editing them produces nonsense the server
                  // would reject anyway. Clearing is the way back.
                  value={state.customerPhoneMasked || state.customerPhone}
                  readOnly={phonePicked}
                  onChange={(e) => actions.setCustomerPhone(e.target.value)}
                  // Deliberately no onFocus handler. Re-opening the list when
                  // the field is merely focused put a stale menu under a
                  // number the cashier had already resolved; the list belongs
                  // to typing, and typing alone.
                  onBlur={() => window.setTimeout(actions.closeSuggestions, 150)}
                  style={compactInput}
                />
              </FieldShell>

              {/*
                The way out of a picked customer. Without it the field is a
                dead end: the mask cannot be edited, so a wrong pick would
                mean clearing the whole bill.
              */}
              {phonePicked ? (
                <button
                  type="button"
                  className="press"
                  title="Detach this customer"
                  onClick={actions.clearPickedCustomer}
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    border: '1px solid #d6dbde',
                    background: '#ffffff',
                    color: 'rgba(0,0,0,0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon icon="lucide:x" size={12} />
                </button>
              ) : null}

              {state.suggestOpen && state.customerSuggestions.length > 0 ? (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 20,
                    marginTop: 4,
                    background: '#ffffff',
                    border: '1px solid #d6dbde',
                    borderRadius: 10,
                    boxShadow: POP_SHADOW,
                    overflow: 'hidden',
                  }}
                >
                  {state.customerSuggestions.map((sug) => (
                    <button
                      key={sug.id}
                      type="button"
                      className="press"
                      // onMouseDown, not onClick: blur fires first otherwise
                      // and the list is gone before the click resolves.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        actions.pickSuggestion(sug);
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '9px 12px',
                        border: 0,
                        borderBottom: '1px solid #f4f3f0',
                        background: 'transparent',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.87)' }}>
                        {sug.name}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.45)' }}>
                        {sug.phoneMasked}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <FieldShell
                label="Name"
                warn={nameMissing || nameOrphaned}
                tint={state.customerKnown}
                hint={
                  state.customerKnown
                    ? 'returning'
                    : // Required only against a number nobody has seen before,
                      // which is the one case the server will refuse.
                      phoneStarted
                      ? 'required for a new number'
                      : 'optional'
                }
              >
                <input
                  type="text"
                  placeholder={phoneStarted ? 'Aarav Mehta' : 'Walk-in — leave blank'}
                  value={state.customer}
                  onChange={(e) => actions.setCustomerName(e.target.value)}
                  style={compactInput}
                />
              </FieldShell>
            </div>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/*
            AnimatePresence is what makes a removed line fade out. Without it a
            row is gone from the DOM the instant the array changes, so there is
            nothing left to transition — this is the case CSS genuinely cannot
            cover, and the reason the library is here at all.

            `layout` slides the rows below a deletion up into the gap rather
            than letting them snap.
          */}
          <AnimatePresence initial={false}>
          {lines.map(({ line, item, lineTotal }) => (
            <motion.div
              key={line.id}
              initial={listRow.initial}
              animate={listRow.animate}
              exit={listRow.exit}
              transition={listRow.transition}
              style={{
                border: '1px solid rgba(0,0,0,0.07)',
                borderRadius: 12,
                padding: 12,
                background: '#f9f9f9',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                // Hold natural height. Without this the column compresses the
                // rows to fit rather than letting the container scroll, which
                // is what made a long cart look unevenly spaced.
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(0,0,0,0.87)' }}>
                    {item.name}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>
                    {money(item.price)} × {line.qty}
                  </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#00754A' }}>
                    {money(lineTotal)}
                  </span>
                  <button
                    type="button"
                    className="press hv-danger"
                    title="Remove item"
                    onClick={() => actions.removeLine(line.id)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      border: '1px solid #d6dbde',
                      background: '#ffffff',
                      color: 'rgba(0,0,0,0.45)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon icon="lucide:trash-2" size={14} />
                  </button>
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    className="press hv-green"
                    onClick={() => actions.bumpQty(line.id, -1)}
                    style={{ ...stepperButton, ...(isMobile ? stepperTouch : null) }}
                  >
                    −
                  </button>
                  <span
                    style={{ minWidth: 18, textAlign: 'center', fontSize: 15, fontWeight: 700 }}
                  >
                    {line.qty}
                  </span>
                  <button
                    type="button"
                    className="press"
                    onClick={() => actions.bumpQty(line.id, 1)}
                    style={{
                      ...stepperButton,
                      ...(isMobile ? stepperTouch : null),
                      border: '1px solid #00754A',
                      background: '#00754A',
                      color: '#ffffff',
                    }}
                  >
                    +
                  </button>
                </span>
                <button
                  type="button"
                  className="press hv-green"
                  onClick={() => actions.patchLine(line.id, { noteOpen: !line.noteOpen })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px',
                    borderRadius: 50,
                    border: '1px solid #d6dbde',
                    background: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'rgba(0,0,0,0.58)',
                  }}
                >
                  <Icon icon="lucide:pencil-line" size={13} />
                  {line.note ? 'Note added' : 'Add note'}
                </button>
              </div>

              {line.noteOpen ? (
                <input
                  type="text"
                  className="focus-green"
                  placeholder="Kitchen note — e.g. no onions"
                  value={line.note}
                  onChange={(e) => actions.patchLine(line.id, { note: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '9px 14px',
                    borderRadius: 50,
                    border: '1px solid #d6dbde',
                    background: '#ffffff',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
              ) : null}
            </motion.div>
          ))}
          </AnimatePresence>

          {state.cart.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 14,
                padding: '40px 24px',
                textAlign: 'center',
              }}
            >
              <span
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  background: '#f2f0eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#00754A',
                }}
              >
                <Icon icon="lucide:shopping-bag" size={30} />
              </span>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                No items yet
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'rgba(0,0,0,0.58)',
                  lineHeight: 1.5,
                  maxWidth: 220,
                }}
              >
                Tap items from the menu and they will show up here, ready to bill.
              </span>
            </div>
          ) : null}
        </div>

        {/*
          The footer is pinned, but it is not allowed to grow without limit.
          Totals, the discount row, the action buttons and the post-payment
          share panel can together outgrow the panel on a short window, and
          because this is `flexShrink: 0` the cart list above is what gives way
          — down to a couple of visible rows.

          Capping it at 62% and letting it scroll internally means the item
          list always keeps roughly a third of the panel, whatever is stacked
          down here.
        */}
        <div
          style={{
            flexShrink: 0,
            maxHeight: '62%',
            overflowY: 'auto',
            borderTop: '1px solid #edebe9',
            background: '#ffffff',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid #d6dbde',
                borderRadius: 50,
                padding: '8px 14px',
              }}
            >
              <Icon icon="lucide:badge-percent" color="rgba(0,0,0,0.45)" />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'rgba(0,0,0,0.58)',
                  whiteSpace: 'nowrap',
                }}
              >
                Discount
              </span>
              <input
                type="text"
                value={state.discountValue}
                onChange={(e) => actions.patch({ discountValue: e.target.value })}
                style={{
                  flex: 1,
                  minWidth: 24,
                  border: 0,
                  padding: 0,
                  textAlign: 'right',
                  fontSize: 15,
                  fontWeight: 700,
                  color: 'rgba(0,0,0,0.87)',
                  background: 'transparent',
                  outline: 'none',
                }}
              />
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: 'rgba(0,0,0,0.58)',
                  flexShrink: 0,
                }}
              >
                {state.discountMode === 'pct' ? '%' : CURRENCY}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 4,
                padding: 3,
                borderRadius: 50,
                background: '#f2f0eb',
                flexShrink: 0,
              }}
            >
              <DiscountMode
                label={CURRENCY}
                active={state.discountMode === 'flat'}
                onClick={() => actions.patch({ discountMode: 'flat' })}
              />
              <DiscountMode
                label="%"
                active={state.discountMode === 'pct'}
                onClick={() => actions.patch({ discountMode: 'pct' })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {/*
              The order number and the table live here rather than in the
              header. They are reference information, not input, and the header
              is the one region that must stay small enough not to squeeze the
              cart.
            */}
            {/*
              Doubles as the collapse control for the breakdown below.
              Collapsing hands the reclaimed height straight to the cart list,
              which is the only `flex: 1` region in the panel — see the note on
              the header about why both ends are pinned.
            */}
            <button
              type="button"
              className="press"
              onClick={() => actions.patch({ totalsOpen: !state.totalsOpen })}
              title={state.totalsOpen ? 'Hide the breakdown' : 'Show the breakdown'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                width: '100%',
                paddingBottom: 4,
                border: 0,
                background: 'transparent',
                textAlign: 'left',
                fontSize: 12,
                fontWeight: 600,
                color: 'rgba(0,0,0,0.45)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon icon="lucide:receipt" size={14} color="#00754A" />
                {open ? `Order #${open.orderNo}` : 'New order'}
                {tableName ? ` · Table ${tableName}` : ''}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {plural(count, 'item')}
                <Icon
                  icon={state.totalsOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'}
                  size={14}
                />
              </span>
            </button>

            {/*
              Subtotal, discount and tax fold away. The Total below does NOT —
              it is the one figure that must be readable at all times, and a
              collapse that could hide it would be a way to take money without
              seeing the amount.
            */}
            {state.totalsOpen ? (
              <>
                <SummaryRow label="Subtotal" value={money(subtotal)} />
                <SummaryRow
                  label="Discount"
                  value={`${discount > 0 ? '− ' : ''}${money(discount)}`}
                />
              </>
            ) : null}
            {state.totalsOpen && CONFIG.showTaxRow ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 14,
                  color: 'rgba(0,0,0,0.32)',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                  Tax
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      padding: '2px 7px',
                      borderRadius: 50,
                      background: '#f2f0eb',
                      color: 'rgba(0,0,0,0.32)',
                    }}
                  >
                    Later
                  </span>
                </span>
                <span style={{ fontWeight: 600 }}>—</span>
              </div>
            ) : null}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 10,
                borderTop: '1px solid #edebe9',
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                Total
              </span>
              <span style={{ fontSize: 24, fontWeight: 800, color: '#00754A', lineHeight: 1.1 }}>
                {money(total)}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {open ? (
              /*
               * The bill exists on the server and the kitchen already has the
               * ticket. The only thing left is which tender settles it — the
               * pay endpoint requires a method, so there is no "just close it"
               * path that leaves the till unreconciled.
               */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'rgba(0,0,0,0.45)',
                  }}
                >
                  Take payment
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['cash', 'card', 'upi'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      className="press hv-primary"
                      disabled={state.checkoutPending}
                      onClick={() => void actions.payBill(method)}
                      style={{
                        ...generateButton,
                        flex: 1,
                        textTransform: 'capitalize',
                        gap: 7,
                        opacity: state.checkoutPending ? 0.6 : 1,
                      }}
                    >
                      {state.checkoutPending ? <Spinner size={14} /> : null}
                      {method}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="press"
                  disabled={state.checkoutPending}
                  onClick={() => {
                    const reason = window.prompt('Why is this bill being voided?')?.trim();
                    // The server demands at least three characters, so an empty
                    // or cancelled prompt must not be sent as a void.
                    if (reason && reason.length >= 3) void actions.voidBill(reason);
                  }}
                  style={{
                    ...outlineGreenButton,
                    borderColor: '#c82014',
                    color: '#c82014',
                  }}
                >
                  <Icon icon="lucide:alert-triangle" size={15} />
                  Void bill
                </button>
              </div>
            ) : canGenerate ? (
              <button
                type="button"
                className="press hv-primary"
                onClick={() => void actions.generateBill()}
                style={generateButton}
              >
                {state.checkoutPending ? (
                  <Spinner size={16} />
                ) : (
                  <Icon icon="lucide:file-check-2" size={17} />
                )}
                {state.checkoutPending ? 'Opening…' : 'Generate Bill'}
              </button>
            ) : (
              <button
                type="button"
                disabled
                title={blocker ?? ''}
                style={{
                  ...generateButton,
                  border: '1px solid #edebe9',
                  background: '#edebe9',
                  color: 'rgba(0,0,0,0.32)',
                  cursor: 'not-allowed',
                }}
              >
                <Icon icon="lucide:lock" size={16} />
                {blocker}
              </button>
            )}

            {/*
              Both print a real thermal receipt now.

              They are DISABLED until an order exists, which is the fix for a
              button that previously fired its toast on an empty cart. Without
              an order there is no order number and no kitchen ticket, so a KOT
              printed here would put food in the kitchen that the board knows
              nothing about.
            */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="press hv-green-fill"
                disabled={!printable || state.printBusy}
                title={printTitle}
                onClick={() => void actions.printKot()}
                style={{
                  ...outlineGreenButton,
                  ...(printable && !state.printBusy ? null : { opacity: 0.45, cursor: 'not-allowed' }),
                }}
              >
                {state.printBusy ? <Spinner size={14} /> : <Icon icon="lucide:printer" size={15} />}
                Print KOT
              </button>
              {/*
                Works BEFORE payment too — an unpaid bill is a normal thing to
                hand someone, and the template marks it UNPAID. Previously this
                required a settled order, so a customer could not be shown what
                they owed before paying it.
              */}
              <button
                type="button"
                className="press hv-green-fill"
                disabled={!printable || state.printBusy}
                title={printTitle}
                onClick={() => void actions.printBill()}
                style={{
                  ...outlineGreenButton,
                  ...(printable && !state.printBusy ? null : { opacity: 0.45, cursor: 'not-allowed' }),
                }}
              >
                {state.printBusy ? (
                  <Spinner size={14} />
                ) : (
                  <Icon icon="lucide:receipt-text" size={15} />
                )}
                Print Bill
              </button>
            </div>

            {/*
              The share panel. It only exists once a bill is settled, because
              the link only exists then — the server mints the token at payment
              and keeps only its hash, so there is nothing to share before and
              no way to rebuild it after.
            */}
            {/*
              Two rows, not three blocks.
              This sits under a cart, a discount control and a totals block in
              a 400px column, so it earns its height: row one states what was
              settled, row two sends it. The collapsible toggle went with the
              third block — a panel that only appears after payment and
              disappears on the next order does not also need hiding.
            */}
            {state.lastSettled ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: 10,
                  borderRadius: 10,
                  background: '#f4faf8',
                  border: '1px solid #bfe0d4',
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'rgba(0,0,0,0.45)',
                  }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {state.lastSettled.invoiceNo}
                    {state.lastSettled.customerName ? ` · ${state.lastSettled.customerName}` : ''}
                  </span>
                  <span style={{ color: '#00754A', fontWeight: 800, whiteSpace: 'nowrap' }}>
                    {money(state.lastSettled.total)}
                  </span>

                </span>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="press hv-green"
                    title={
                      state.lastSettled.phone
                        ? `Send to ${state.lastSettled.phone}`
                        : 'No phone on this bill'
                    }
                    onClick={actions.shareOnWhatsApp}
                    disabled={!state.lastSettled.phone}
                    style={{
                      ...shareButton,
                      ...(state.lastSettled.phone
                        ? { border: '1px solid #00754A', background: '#00754A', color: '#ffffff' }
                        : { opacity: 0.45 }),
                    }}
                  >
                    <Icon
                      icon="lucide:message-circle"
                      size={14}
                      color={state.lastSettled.phone ? '#ffffff' : 'rgba(0,0,0,0.45)'}
                    />
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    className="press hv-green"
                    title="Copy the invoice link"
                    onClick={actions.copyInvoiceLink}
                    style={shareButton}
                  >
                    <Icon icon="lucide:link" size={14} />
                    Copy
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      {state.tablePickerOpen ? <TableSelectOverlay /> : null}
    </main>
  );
}

/**
 * Compact bordered field. The billing panel has to fit an order type, two
 * customer fields, a table picker, the cart and a totals block into 400px, so
 * these are deliberately tighter than the `Field` used in modals.
 */
function FieldShell({
  label,
  hint,
  warn,
  tint,
  children,
}: {
  label: string;
  hint?: string;
  warn?: boolean;
  tint?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        border: `1px solid ${warn ? '#cba258' : '#d6dbde'}`,
        borderRadius: 10,
        padding: '6px 10px 7px',
        background: tint ? '#f7faf9' : '#ffffff',
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: warn ? '#8a6a24' : 'rgba(0,0,0,0.45)',
        }}
      >
        {label}
        {hint ? (
          <span style={{ textTransform: 'none', letterSpacing: 0, color: '#00754A' }}>{hint}</span>
        ) : null}
      </span>
      {children}
    </div>
  );
}

/**
 * Table chooser, as an overlay.
 *
 * It used to be a wrap of buttons inside the billing panel header, which grew
 * the header and pushed the cart down — the reason the chosen items were hard
 * to see. Lifting it out keeps the panel's three regions fixed and gives the
 * tables enough room to show seats and zone, which is what the choice actually
 * turns on.
 *
 * Only available tables are offered: seating one that already holds a bill is
 * refused by the server with a 409, so listing occupied tables would be
 * offering a choice that cannot be taken. The current pick stays listed even
 * if someone else seats it, so a selection never silently disappears.
 */
function TableSelectOverlay() {
  const { state, actions } = usePos();
  const options = state.tables.filter((t) => t.status === 'available' || t.id === state.orderTable);

  const zones = [...new Set(options.map((t) => t.zone))];

  return (
    <div
      onClick={actions.closeTablePicker}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 400,
          maxWidth: '100%',
          height: '100%',
          background: '#ffffff',
          boxShadow: POP_SHADOW,
          display: 'flex',
          flexDirection: 'column',
          animation: 'riseIn 0.2s ease-out',
        }}
      >
        <div
          style={{
            flexShrink: 0,
            padding: 20,
            borderBottom: '1px solid #edebe9',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: 'rgba(0,0,0,0.87)' }}>
              Choose a table
            </span>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>
              {plural(options.length, 'table')} free
            </span>
          </span>
          <button
            type="button"
            className="press"
            onClick={actions.closeTablePicker}
            aria-label="Close"
            style={{ border: 0, background: 'transparent', padding: 4, cursor: 'pointer' }}
          >
            <Icon icon="lucide:x" size={18} color="rgba(0,0,0,0.45)" />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
          {options.length === 0 ? (
            <p
              style={{
                margin: 0,
                padding: '24px 0',
                textAlign: 'center',
                fontSize: 14,
                fontWeight: 500,
                color: 'rgba(0,0,0,0.58)',
              }}
            >
              Every table is occupied. Settle a bill, or switch this order to takeaway.
            </p>
          ) : (
            zones.map((zone) => (
              <div key={zone} style={{ marginBottom: 20 }}>
                <span
                  style={{
                    display: 'block',
                    marginBottom: 10,
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'rgba(0,0,0,0.45)',
                  }}
                >
                  {zone}
                </span>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
                    gap: 10,
                  }}
                >
                  {options
                    .filter((t) => t.zone === zone)
                    .map((t) => {
                      const active = t.id === state.orderTable;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className="press hv-lift"
                          onClick={() => actions.chooseTable(active ? null : t.id)}
                          style={{
                            padding: '12px 10px',
                            borderRadius: 12,
                            border: `2px solid ${active ? '#00754A' : '#d6dbde'}`,
                            background: active ? '#d4e9e2' : '#ffffff',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 4,
                            cursor: 'pointer',
                          }}
                        >
                          <span
                            style={{
                              fontSize: 20,
                              fontWeight: 800,
                              lineHeight: 1,
                              color: active ? '#00754A' : 'rgba(0,0,0,0.87)',
                            }}
                          >
                            {t.name}
                          </span>
                          <span
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 11,
                              fontWeight: 600,
                              color: 'rgba(0,0,0,0.45)',
                            }}
                          >
                            <Icon icon="lucide:users" size={11} />
                            {t.seats}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 14,
      }}
    >
      <span style={{ fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'rgba(0,0,0,0.87)' }}>{value}</span>
    </div>
  );
}

function DiscountMode({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="press"
      onClick={onClick}
      style={{
        padding: '6px 13px',
        borderRadius: 50,
        border: 0,
        fontSize: 13,
        fontWeight: 700,
        background: active ? '#ffffff' : 'transparent',
        color: active ? '#00754A' : 'rgba(0,0,0,0.45)',
      }}
    >
      {label}
    </button>
  );
}

/** Width and height move together, or the 50% radius stops being a circle. */
const stepperTouch: CSSProperties = { width: 38, height: 38, minHeight: 38, fontSize: 19 };

const stepperButton: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: '50%',
  border: '1px solid #d6dbde',
  background: '#ffffff',
  color: 'rgba(0,0,0,0.87)',
  fontSize: 16,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const generateButton: CSSProperties = {
  width: '100%',
  padding: '13px 24px',
  borderRadius: 50,
  border: '1px solid #00754A',
  background: '#00754A',
  color: '#ffffff',
  fontSize: 15,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

const outlineGreenButton: CSSProperties = {
  flex: 1,
  padding: '11px 14px',
  borderRadius: 50,
  border: '1px solid #00754A',
  background: '#ffffff',
  color: '#00754A',
  fontSize: 13,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
};

/** The two share actions. Tighter than the panel buttons above them — this
 *  row sits below an already-tall column and only has to be tappable. */
const shareButton: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '9px 12px',
  borderRadius: 50,
  border: '1px solid #d6dbde',
  background: '#ffffff',
  color: 'rgba(0,0,0,0.87)',
  fontSize: 12,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
};
