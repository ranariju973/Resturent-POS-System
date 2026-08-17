import { useMemo } from 'react';
import { Icon } from '../icons/Icon';
import { usePos } from '../store';
import { useIsMobile } from '../lib/useViewport';
import { money, plural } from '../lib/format';
import {
  CARD_SHADOW,
  IconButton,
  LoadState,
  PageHeading,
  SearchInput,
  Toggle,
  card,
  primaryPill,
} from '../components/ui';
import { SkeletonGrid } from '../components/motion';
import { CategoryModal, DeleteModal, ItemModal } from '../components/menuModals';

export function MenuManagement() {
  const { state, actions } = usePos();
  const isMobile = useIsMobile();

  const itemQuery = state.itemQuery.trim().toLowerCase();

  /**
   * One tally for the whole sidebar instead of a filter per category.
   *
   * The per-category `state.items.filter(...).length` this replaces ran inside
   * the .map over categories, so it was O(cats × items) on every render.
   *
   * The server does send `itemCount` on each category and using it would be
   * tempting — but saveItem patches `state.items` locally without refetching
   * categories, so that number goes stale the instant you add an item. Counting
   * from the same array the list renders from keeps the sidebar honest.
   */
  const countByCat = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of state.items) counts.set(i.cat, (counts.get(i.cat) ?? 0) + 1);
    return counts;
  }, [state.items]);

  const inCategory = state.items.filter((i) => i.cat === state.selCat);
  // selCat is a category id, so the heading has to look the name up rather
  // than print the key.
  const selCatName = state.cats.find((c) => c.id === state.selCat)?.name ?? '';
  const visible = inCategory.filter((i) => !itemQuery || i.name.toLowerCase().includes(itemQuery));

  return (
    <>
      <main
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: isMobile ? 12 : 16,
          padding: isMobile ? 14 : 24,
        }}
      >
        <PageHeading
          title="Menu Management"
          subtitle="Categories and items that populate the POS grid"
          right={
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.58)' }}>
              {inCategory.length} items in {selCatName || '—'}
            </span>
          }
        />

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: isMobile ? 12 : 24,
          }}
        >
          <section
            style={{
              ...card,
              width: isMobile ? '100%' : 288,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: isMobile ? 12 : 16,
              /*
               * On mobile the categories are a short auto-height block that
               * scrolls sideways, not a tall pane.
               *
               * It used to be `maxHeight: 38dvh` inside a `minHeight: 0`
               * column, which left the items grid below it almost no height —
               * so the grid had nothing to scroll and the screen felt frozen.
               * Sizing to content here gives the grid the rest of the column.
               */
              ...(isMobile ? { flexShrink: 0 } : null),
            }}
          >
            <button
              type="button"
              className="press hv-primary"
              onClick={() => actions.openCatModal(null)}
              style={{ ...primaryPill, width: '100%', justifyContent: 'center', padding: '11px 18px' }}
            >
              <Icon icon="lucide:plus" />
              Add Category
            </button>

            <div
              style={
                isMobile
                  ? {
                      // A single swipeable row. Vertical space is the scarce
                      // resource on a phone; horizontal is free.
                      display: 'flex',
                      flexDirection: 'row',
                      gap: 8,
                      overflowX: 'auto',
                      paddingBottom: 4,
                      scrollbarWidth: 'none',
                    }
                  : {
                      flex: 1,
                      minHeight: 0,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      paddingRight: 2,
                    }
              }
            >
              {state.cats.map((cat) => {
                const active = cat.id === state.selCat;
                const count = countByCat.get(cat.id) ?? 0;
                const showTools = active || state.hoverCat === cat.id;
                return (
                  <div
                    key={cat.id}
                    onClick={() => actions.patch({ selCat: cat.id, itemQuery: '' })}
                    onMouseEnter={() => actions.patch({ hoverCat: cat.id })}
                    onMouseLeave={() => actions.patch({ hoverCat: '' })}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '11px 12px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      background: active ? '#d4e9e2' : '#ffffff',
                      border: `1px solid ${active ? '#00754A' : '#edebe9'}`,
                      // In the horizontal strip a chip sizes to its label and
                      // must not be squeezed by its neighbours.
                      ...(isMobile ? { flexShrink: 0 } : null),
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        flexShrink: 0,
                        background: cat.color,
                      }}
                    />
                    <span
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        minWidth: 0,
                        // `flex: 1` fills the sidebar row on desktop; in the
                        // mobile strip it would stretch every chip equally.
                        flex: isMobile ? undefined : 1,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: active ? 700 : 600,
                          color: active ? '#1E3932' : 'rgba(0,0,0,0.87)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {cat.name}
                      </span>
                      <span
                        style={{ fontSize: 11, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}
                      >
                        {plural(count, 'item')}
                      </span>
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        gap: 6,
                        flexShrink: 0,
                        transition: 'opacity 0.2s ease',
                        /*
                         * `showTools` is hover-driven, and a touch screen has
                         * no hover — these controls were simply unreachable on
                         * a phone. There, show them on the selected chip only,
                         * which keeps the strip from turning into a wall of
                         * icons.
                         */
                        opacity: isMobile ? (active ? 1 : 0) : showTools ? 1 : 0,
                        ...(isMobile && !active ? { display: 'none' } : null),
                      }}
                    >
                      <IconButton
                        icon="lucide:pencil"
                        title="Edit category"
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.openCatModal(cat);
                        }}
                      />
                      <IconButton
                        icon="lucide:trash-2"
                        title="Delete category"
                        danger
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.openDeleteModal('cat', cat.name);
                        }}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section
            style={{
              ...card,
              flex: 1,
              // Without this the grid below cannot shrink, so it overflows the
              // column instead of scrolling inside it.
              minHeight: 0,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: isMobile ? 12 : 16,
              padding: isMobile ? 12 : 16,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: isMobile ? 8 : 12,
                flexShrink: 0,
              }}
            >
              <SearchInput
                placeholder={isMobile ? 'Search items' : `Search items in ${selCatName || 'No category'}`}
                value={state.itemQuery}
                onChange={(itemQuery) => actions.patch({ itemQuery })}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                className="press hv-primary"
                onClick={() => actions.openItemModal(null)}
                style={{
                  ...primaryPill,
                  flexShrink: 0,
                  // Icon-only on a phone: the label costs the search field
                  // most of its width and the plus reads the same.
                  ...(isMobile ? { padding: '11px 14px' } : null),
                }}
                title="Add Menu Item"
              >
                <Icon icon="lucide:plus" />
                {isMobile ? null : 'Add Menu Item'}
              </button>
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                padding: '2px 4px 4px 2px',
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 156 : 200}px, 1fr))`,
                gap: isMobile ? 10 : 16,
                alignContent: 'start',
              }}
            >
              {visible.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: '1px solid rgba(0,0,0,0.07)',
                    background: '#ffffff',
                    boxShadow: CARD_SHADOW,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    minWidth: 0,
                  }}
                >
                  <img
                    src={item.img}
                    alt={item.name}
                    style={{
                      width: '100%',
                      height: 104,
                      borderRadius: 10,
                      objectFit: 'cover',
                      display: 'block',
                      background: '#edebe9',
                    }}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'rgba(0,0,0,0.87)',
                        lineHeight: 1.3,
                        minWidth: 0,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {item.name}
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
                        {money(item.price)}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}>
                        {item.catName}
                      </span>
                    </span>
                  </span>
                  {/*
                    The stock toggle and the two icon buttons need about 178px
                    together, and a card on a phone gives 124px — which is why
                    the icons were sitting on top of the toggle. Wrapping is
                    the backstop; dropping the label is what usually avoids it.
                  */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 8,
                      paddingTop: 6,
                      borderTop: '1px solid #edebe9',
                    }}
                  >
                    <button
                      type="button"
                      className="press"
                      title={item.available ? 'In stock' : 'Sold out'}
                      onClick={() => actions.toggleAvailable(item.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: isMobile ? 0 : 8,
                        padding: isMobile ? 6 : '6px 12px 6px 6px',
                        borderRadius: 50,
                        border: 0,
                        fontSize: 11,
                        fontWeight: 700,
                        minWidth: 0,
                        background: item.available ? '#d4e9e2' : '#f2f0eb',
                        color: item.available ? '#00754A' : 'rgba(0,0,0,0.45)',
                      }}
                    >
                      <Toggle on={item.available} />
                      {isMobile ? null : item.available ? 'In stock' : 'Sold out'}
                    </button>
                    <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <IconButton
                        icon="lucide:pencil"
                        title="Edit item"
                        onClick={() => actions.openItemModal(item)}
                      />
                      <IconButton
                        icon="lucide:trash-2"
                        title="Delete item"
                        danger
                        onClick={() => actions.openDeleteModal('item', item.id)}
                      />
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <LoadState
              loading={state.menuLoading}
              skeleton={<SkeletonGrid count={isMobile ? 6 : 9} minWidth={isMobile ? 148 : 200} />}
              error={state.menuError}
              empty={!state.menuLoading && !state.menuError && visible.length === 0}
              emptyMessage="Nothing here yet — add a menu item to this category."
              onRetry={() => void actions.loadMenu()}
            />
          </section>
        </div>
      </main>

      <CategoryModal />
      <ItemModal />
      <DeleteModal />
    </>
  );
}
