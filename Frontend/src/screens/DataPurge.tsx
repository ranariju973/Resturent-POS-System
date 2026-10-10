import { useState } from 'react';
import { usePos } from '../store';
import { PageHeading, card, ModalOverlay, ModalTitle, ModalActions, bareInput, Field } from '../components/ui';
import { Icon } from '../icons/Icon';
import { purgeData, type PurgeCategory, type PurgeResult } from '../lib/dataPurgeApi';

interface CategoryCard {
  id: PurgeCategory;
  title: string;
  icon: string;
  description: string;
}

const CATEGORIES: CategoryCard[] = [
  {
    id: 'menu',
    title: 'Menu Management',
    icon: 'lucide:utensils',
    description: 'Deletes all menu items, categories, and associated images from Cloudinary.',
  },
  {
    id: 'tables',
    title: 'Table Management',
    icon: 'lucide:layout-dashboard',
    description: 'Deletes all tables, zones, and seating arrangements.',
  },
  {
    id: 'kitchen',
    title: 'Kitchen Management',
    icon: 'lucide:flame',
    description: 'Deletes all kitchen tickets (pending, preparing, ready, served).',
  },
  {
    id: 'customers',
    title: 'Customer Data',
    icon: 'lucide:users',
    description: 'Deletes all customer profiles and their historical metrics.',
  },
  {
    id: 'reports',
    title: 'Reports Section Data',
    icon: 'lucide:bar-chart-3',
    description: 'Deletes all orders, expenses, attendance records, payroll, and resets daily order counters.',
  },
];

export function DataPurge() {
  const { actions } = usePos();
  const [purging, setPurging] = useState<PurgeCategory | null>(null);

  const confirmPurge = (category: PurgeCategory) => {
    setPurging(category);
  };

  const closeConfirm = () => {
    setPurging(null);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header
        style={{
          padding: '24px 24px 16px',
          background: '#ffffff',
          borderBottom: '1px solid #d6dbde',
        }}
      >
        <PageHeading
          title="Clear All Data"
          subtitle="Irreversibly delete data for your restaurant. This action cannot be undone."
        />

        <div
          style={{
            marginTop: 20,
            padding: '12px 16px',
            background: '#fff2f1',
            border: '1px solid #fecaca',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            color: '#c82014',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <Icon icon="lucide:alert-circle" size={20} />
          <div style={{ fontWeight: 500 }}>
            <strong style={{ display: 'block', fontWeight: 700, marginBottom: 4 }}>
              Danger Zone
            </strong>
            Deleting data here will permanently erase it from the database. It cannot be recovered. 
            Proceed with extreme caution.
          </div>
        </div>
      </header>

      <main style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 800, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {CATEGORIES.map((cat) => (
            <div
              key={cat.id}
              style={{
                ...card,
                padding: '20px 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 20,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: '#f9f9f9',
                    border: '1px solid #d6dbde',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'rgba(0,0,0,0.58)',
                  }}
                >
                  <Icon icon={cat.icon} size={22} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                    {cat.title}
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: 14, color: 'rgba(0,0,0,0.58)' }}>
                    {cat.description}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="press hv-danger"
                onClick={() => confirmPurge(cat.id)}
                style={{
                  padding: '9px 16px',
                  borderRadius: 50,
                  border: '1px solid #c82014',
                  background: '#ffffff',
                  color: '#c82014',
                  fontSize: 13,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                Clear Data
              </button>
            </div>
          ))}
        </div>
      </main>

      {purging && (
        <PurgeModal
          category={CATEGORIES.find((c) => c.id === purging)!}
          onClose={closeConfirm}
          onSuccess={(res) => {
            const keys = Object.keys(res.counts);
            const countStr = keys.map(k => `${res.counts[k]} ${k}`).join(', ');
            actions.flash(`Cleared ${countStr}.`);
            closeConfirm();
          }}
        />
      )}
    </div>
  );
}

function PurgeModal({
  category,
  onClose,
  onSuccess,
}: {
  category: CategoryCard;
  onClose: () => void;
  onSuccess: (res: PurgeResult) => void;
}) {
  const { actions } = usePos();
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  const canSave = confirmText === 'DELETE' && !busy;

  const handlePurge = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const res = await purgeData(category.id);
      onSuccess(res);
    } catch (err: any) {
      actions.flash(err.message || 'Failed to clear data', 'error');
      setBusy(false);
    }
  };

  return (
    <ModalOverlay maxWidth={460}>
      <ModalTitle>Clear {category.title}</ModalTitle>
      <p style={{ margin: '4px 0 16px', fontSize: 14, color: '#c82014', fontWeight: 500 }}>
        This action is irreversible. All associated data will be permanently deleted.
      </p>

      <Field
        label="Type DELETE to confirm"
        htmlFor="purge-confirm"
        borderColor={confirmText === 'DELETE' ? '#00754A' : '#d6dbde'}
      >
        <input
          id="purge-confirm"
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          autoComplete="off"
          style={bareInput}
        />
      </Field>

      <div style={{ marginTop: 24 }}>
        <ModalActions
          onCancel={onClose}
          onSave={handlePurge}
          saveLabel="Clear Data"
          busyLabel="Clearing…"
          destructive
          busy={busy}
          saveDisabled={!canSave}
        />
      </div>
    </ModalOverlay>
  );
}
