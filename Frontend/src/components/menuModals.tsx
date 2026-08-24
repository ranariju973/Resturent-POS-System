import { Icon } from '../icons/Icon';
import { SWATCHES } from '../data/seed';
import { usePos } from '../store';
import { plural } from '../lib/format';
import {
  Field,
  ModalActions,
  ModalOverlay,
  ModalTitle,
  Toggle,
  bareInput,
} from './ui';

export function CategoryModal() {
  const { state, actions } = usePos();
  if (state.modal?.kind !== 'cat') return null;
  const title = `${state.modal.mode === 'edit' ? 'Edit' : 'Add'} category`;

  return (
    <ModalOverlay maxWidth={420} gap={18}>
      <ModalTitle>{title}</ModalTitle>

      <Field label="Category name" htmlFor="catname">
        <input
          id="catname"
          type="text"
          placeholder="e.g. Desserts"
          value={state.draft.name}
          onChange={(e) => actions.setDraft({ name: e.target.value })}
          style={bareInput}
        />
      </Field>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'rgba(0,0,0,0.58)',
          }}
        >
          Colour tag
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          {SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              className="press"
              aria-label={`Colour ${color}`}
              onClick={() => actions.setDraft({ color })}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: '2px solid #ffffff',
                background: color,
                boxShadow: state.draft.color === color ? '0 0 0 3px #d4e9e2' : 'none',
              }}
            />
          ))}
        </div>
      </div>

      <ModalActions onCancel={actions.closeModal} onSave={actions.saveCat} busy={state.menuSaving} />
    </ModalOverlay>
  );
}

export function ItemModal() {
  const { state, actions } = usePos();
  if (state.modal?.kind !== 'item') return null;
  const title = `${state.modal.mode === 'edit' ? 'Edit' : 'Add'} menu item`;

  return (
    <ModalOverlay maxWidth={460} scroll gap={16}>
      <ModalTitle>{title}</ModalTitle>

      <label
        htmlFor="itemimg"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: 12,
          borderRadius: 12,
          border: '1px dashed #d6dbde',
          background: '#f9f9f9',
          cursor: 'pointer',
        }}
      >
        {state.draft.img ? (
          <img
            src={state.draft.img}
            alt=""
            style={{
              width: 64,
              height: 64,
              borderRadius: 10,
              objectFit: 'cover',
              display: 'block',
              flexShrink: 0,
            }}
          />
        ) : (
          <span
            style={{
              width: 64,
              height: 64,
              borderRadius: 10,
              background: '#edebe9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#00754A',
              flexShrink: 0,
            }}
          >
            <Icon icon="lucide:image-plus" size={24} />
          </span>
        )}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
            Item photo
          </span>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}>
            Choose a square image — shown on the POS grid
          </span>
        </span>
        <input
          id="itemimg"
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) actions.pickImage(file);
          }}
          style={{ display: 'none' }}
        />
      </label>

      <div style={{ display: 'flex', gap: 12 }}>
        <Field label="Name" htmlFor="itemname" style={{ flex: 1, minWidth: 0 }}>
          <input
            id="itemname"
            type="text"
            placeholder="e.g. Iced Americano"
            value={state.draft.name}
            onChange={(e) => actions.setDraft({ name: e.target.value })}
            style={bareInput}
          />
        </Field>
        <Field label="Price" htmlFor="itemprice" style={{ width: 120, flexShrink: 0 }}>
          <input
            id="itemprice"
            type="text"
            placeholder="0.00"
            value={state.draft.price}
            onChange={(e) => actions.setDraft({ price: e.target.value })}
            style={bareInput}
          />
        </Field>
      </div>

      <Field label="Category" htmlFor="itemcat">
        <select
          id="itemcat"
          value={state.draft.cat}
          onChange={(e) => actions.setDraft({ cat: e.target.value })}
          style={{ ...bareInput, appearance: 'none' }}
        >
          {state.cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Description" htmlFor="itemdesc">
        <textarea
          id="itemdesc"
          rows={3}
          placeholder="Short description for the kitchen and receipts"
          value={state.draft.desc}
          onChange={(e) => actions.setDraft({ desc: e.target.value })}
          style={{
            ...bareInput,
            fontSize: 14,
            fontWeight: 500,
            resize: 'none',
            fontFamily: 'inherit',
          }}
        />
      </Field>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.58)' }}>
          Availability
        </span>
        <button
          type="button"
          className="press"
          onClick={() => actions.setDraft({ available: !state.draft.available })}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 14px 7px 7px',
            borderRadius: 50,
            border: '1px solid #d6dbde',
            background: '#ffffff',
            fontSize: 12,
            fontWeight: 700,
            color: 'rgba(0,0,0,0.87)',
          }}
        >
          <Toggle on={state.draft.available} />
          {state.draft.available ? 'In stock' : 'Sold out'}
        </button>
      </div>

      <ModalActions
        onCancel={actions.closeModal}
        onSave={actions.saveItem}
        busy={state.menuSaving}
        busyLabel={state.draft.file ? 'Uploading…' : 'Saving…'}
      />
    </ModalOverlay>
  );
}

export function DeleteModal() {
  const { state, actions } = usePos();
  const modal = state.modal;
  if (modal?.kind !== 'del') return null;

  const isCategory = modal.delKind === 'cat';
  /*
   * `modal.target` is an ID for both kinds — it is what goes into the request
   * URL. The name is looked up purely for display: keying the modal on a name
   * meant the delete request carried a name too, which the route's ObjectId
   * schema rejected with a bare "Validation failed".
   */
  const category = isCategory ? state.cats.find((c) => c.id === modal.target) : undefined;
  const blocking = isCategory ? state.items.filter((i) => i.cat === modal.target).length : 0;

  return (
    <ModalOverlay maxWidth={400}>
      <span
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'rgba(200,32,20,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#c82014',
        }}
      >
        <Icon icon="lucide:alert-triangle" size={22} />
      </span>
      <ModalTitle>{isCategory ? 'Delete category?' : 'Delete item?'}</ModalTitle>
      <p
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 500,
          color: 'rgba(0,0,0,0.58)',
          lineHeight: 1.5,
        }}
      >
        {isCategory
          ? blocking > 0
            ? 'A category can only be deleted once it is empty.'
            : 'This will remove the category from the POS menu. Are you sure?'
          : 'This will remove the item from the POS menu. Are you sure?'}
      </p>
      {isCategory && blocking > 0 ? (
        <p
          style={{
            margin: 0,
            padding: '11px 14px',
            borderRadius: 12,
            background: '#faf6ee',
            fontSize: 13,
            fontWeight: 600,
            color: '#8a6a24',
            lineHeight: 1.45,
          }}
        >
          “{category?.name ?? 'This category'}” still has {plural(blocking, 'item')}. Move or delete
          them first.
        </p>
      ) : null}
      <ModalActions
        onCancel={actions.closeModal}
        onSave={actions.confirmDelete}
        saveLabel="Delete"
        busyLabel="Deleting…"
        busy={state.menuSaving}
        // The server refuses a non-empty category with a 409, so offering the
        // button would only produce an error the modal already knows about.
        saveDisabled={isCategory && blocking > 0}
        destructive
      />
    </ModalOverlay>
  );
}
