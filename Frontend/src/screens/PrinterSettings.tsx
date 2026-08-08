/**
 * Printer and receipt settings. Admin only — `settings:manage`.
 *
 * The nav omits this for anyone without the permission, App.tsx refuses to
 * render it, and both endpoints behind it 403 — the last of those is what
 * actually enforces it.
 *
 * Three tabs, because they are one subject seen three ways: how the paper
 * comes out, what is printed on it, and where it goes.
 */
import { useEffect } from 'react';
import { Icon } from '../icons/Icon';
import { usePos } from '../store';
import { useIsMobile } from '../lib/useViewport';
import { billHtml } from '../components/print/receiptHtml';
import {
  ErrorLine,
  Field,
  FilterPill,
  LoadState,
  PageHeading,
  StatusBadge,
  bareInput,
  card,
  primaryPill,
} from '../components/ui';
import { Spinner } from '../components/motion';
import type { PaperWidth } from '../lib/printing/types';

const TABS = [
  { id: 'receipt', label: 'Receipt' },
  { id: 'business', label: 'Business' },
  { id: 'printers', label: 'Printers' },
] as const;

export function PrinterSettings() {
  const { state, actions } = usePos();
  const isMobile = useIsMobile();
  const draft = state.printerDraft;

  useEffect(() => {
    void actions.loadPrinterSettings();
    void actions.checkQz();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A save button that is always enabled teaches people to ignore it.
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.printerSettings);

  return (
    <main
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: isMobile ? 12 : 16,
        padding: isMobile ? 14 : 24,
      }}
    >
      <PageHeading
        title="Printer Settings"
        subtitle="Paper size, receipt details and where each job prints"
        right={
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/*
              Test print uses the DRAFT, not the saved settings — checking a
              paper size should not require committing it first.
            */}
            <button
              type="button"
              className="press hv-neutral"
              disabled={state.printBusy}
              onClick={() => void actions.printTestReceipt('kot')}
              style={secondaryPill}
            >
              <Icon icon="lucide:printer" size={15} />
              Test KOT
            </button>
            <button
              type="button"
              className="press hv-neutral"
              disabled={state.printBusy}
              onClick={() => void actions.printTestReceipt('bill')}
              style={secondaryPill}
            >
              <Icon icon="lucide:receipt-text" size={15} />
              Test bill
            </button>
            <button
              type="button"
              className="press hv-primary"
              disabled={!dirty || state.printerSaving}
              onClick={() => void actions.savePrinterSettings()}
              style={{
                ...primaryPill,
                ...(dirty && !state.printerSaving ? null : { opacity: 0.5, cursor: 'default' }),
              }}
            >
              {state.printerSaving ? <Spinner size={15} /> : <Icon icon="lucide:check" size={15} />}
              {state.printerSaving ? 'Saving…' : 'Save'}
            </button>
          </span>
        }
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TABS.map((tab) => (
          <FilterPill
            key={tab.id}
            label={tab.label}
            active={state.printTab === tab.id}
            onClick={() => actions.setPrintTab(tab.id)}
          />
        ))}
      </div>

      <LoadState
        loading={state.printerLoading}
        error={state.printerError}
        onRetry={() => void actions.loadPrinterSettings()}
      />

      {state.printerLoading ? null : (
        <>
          {state.printTab === 'receipt' ? (
            <section style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Row label="Paper width" hint="Thermal rolls come in these two sizes.">
                <span style={{ display: 'flex', gap: 8 }}>
                  {([58, 80] as PaperWidth[]).map((w) => (
                    <FilterPill
                      key={w}
                      label={`${w}mm`}
                      active={draft.paperWidth === w}
                      onClick={() => actions.setPrinterDraft({ paperWidth: w })}
                    />
                  ))}
                </span>
              </Row>

              <Row
                label="Copies"
                hint="Under browser printing each copy opens its own dialog."
              >
                <span style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <Counter
                    label="Bill"
                    value={draft.billCopies}
                    onChange={(billCopies) => actions.setPrinterDraft({ billCopies })}
                  />
                  <Counter
                    label="KOT"
                    value={draft.kotCopies}
                    onChange={(kotCopies) => actions.setPrinterDraft({ kotCopies })}
                  />
                </span>
              </Row>

              {/*
                A live preview at the real paper width. A settings page whose
                effect can only be seen by printing is a page nobody trusts.
              */}
              <Row label="Preview" hint="The bill at the chosen width.">
                <div
                  style={{
                    width: draft.paperWidth === 58 ? 220 : 300,
                    maxWidth: '100%',
                    border: '1px solid #d6dbde',
                    borderRadius: 8,
                    background: '#ffffff',
                    padding: 10,
                    fontFamily: 'ui-monospace, "Courier New", monospace',
                    fontSize: draft.paperWidth === 58 ? 9 : 10,
                    lineHeight: 1.35,
                    color: '#000',
                    overflowX: 'auto',
                  }}
                  dangerouslySetInnerHTML={{ __html: previewHtml(draft) }}
                />
              </Row>
            </section>
          ) : null}

          {state.printTab === 'business' ? (
            <section style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'rgba(0,0,0,0.58)' }}>
                Printed at the top of a customer bill. A kitchen ticket never carries these —
                the cook has no use for an address. Leave a field blank to fall back to the
                built-in default shown in grey.
              </p>
              <Field label="Business name" htmlFor="bizname">
                <input
                  id="bizname"
                  value={draft.businessName}
                  placeholder={state.printerSettings.effectiveName}
                  onChange={(e) => actions.setPrinterDraft({ businessName: e.target.value })}
                  style={bareInput}
                />
              </Field>
              <Field label="Address" htmlFor="bizaddr">
                <input
                  id="bizaddr"
                  value={draft.businessAddress}
                  placeholder="12 MG Road, Andheri West"
                  onChange={(e) => actions.setPrinterDraft({ businessAddress: e.target.value })}
                  style={bareInput}
                />
              </Field>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Field label="Phone" htmlFor="bizphone" style={{ flex: 1, minWidth: 160 }}>
                  <input
                    id="bizphone"
                    value={draft.businessPhone}
                    onChange={(e) => actions.setPrinterDraft({ businessPhone: e.target.value })}
                    style={bareInput}
                  />
                </Field>
                <Field label="GST number" htmlFor="bizgst" style={{ flex: 1, minWidth: 160 }}>
                  <input
                    id="bizgst"
                    value={draft.gstNumber}
                    placeholder="27AAAAA0000A1Z5"
                    onChange={(e) => actions.setPrinterDraft({ gstNumber: e.target.value })}
                    style={bareInput}
                  />
                </Field>
              </div>
              <Field label="Footer line" htmlFor="bizfooter">
                <input
                  id="bizfooter"
                  value={draft.footerLine}
                  placeholder={state.printerSettings.effectiveFooter}
                  onChange={(e) => actions.setPrinterDraft({ footerLine: e.target.value })}
                  style={bareInput}
                />
              </Field>
            </section>
          ) : null}

          {state.printTab === 'printers' ? (
            <section style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Row
                label="Print engine"
                hint="Saved on this device only — one till can use QZ while a tablet uses the browser."
              >
                <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <FilterPill
                    label="Browser"
                    active={state.printTransport === 'browser'}
                    onClick={() => actions.setPrintTransport('browser')}
                  />
                  <FilterPill
                    label="QZ Tray"
                    active={state.printTransport === 'qz'}
                    onClick={() => actions.setPrintTransport('qz')}
                  />
                  {state.qzChecking ? (
                    <Spinner size={14} />
                  ) : (
                    <StatusBadge
                      bg={state.qzAvailable ? '#d4e9e2' : '#f4f3f0'}
                      fg={state.qzAvailable ? '#00754A' : 'rgba(0,0,0,0.45)'}
                      label={state.qzAvailable ? 'QZ connected' : 'QZ not detected'}
                    />
                  )}
                  <button
                    type="button"
                    className="press hv-neutral"
                    onClick={() => void actions.checkQz()}
                    style={{ ...secondaryPill, padding: '7px 14px', fontSize: 12 }}
                  >
                    Re-check
                  </button>
                </span>
              </Row>

              {state.printTransport === 'browser' ? (
                <ErrorLine message="Named printers need QZ Tray. Browser printing uses whichever printer you pick in the dialog." />
              ) : null}

              {/*
                A connected daemon that reports no printers is its own state,
                and worth naming: QZ is working, the machine simply has nothing
                installed to print to. Without this the dropdowns are just
                empty and it reads as a broken connection.
              */}
              {state.printTransport === 'qz' && state.qzAvailable && state.qzPrinters.length === 0 ? (
                <ErrorLine message="QZ Tray is connected but this computer has no printers installed. Add one in System Settings, then Re-check." />
              ) : null}

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <PrinterPicker
                  id="kotprinter"
                  label="Kitchen printer"
                  placeholder="XPrinter XP58"
                  value={draft.kotPrinterName}
                  options={state.qzPrinters}
                  disabled={state.printTransport === 'browser'}
                  onChange={(kotPrinterName) => actions.setPrinterDraft({ kotPrinterName })}
                />
                <PrinterPicker
                  id="billprinter"
                  label="Bill printer"
                  placeholder="EPSON TM-T82"
                  value={draft.billPrinterName}
                  options={state.qzPrinters}
                  disabled={state.printTransport === 'browser'}
                  onChange={(billPrinterName) => actions.setPrinterDraft({ billPrinterName })}
                />
              </div>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

/**
 * A printer name — chosen from what QZ reports, or typed.
 *
 * A `datalist` rather than a `<select>`: the printer may be configured on a
 * different terminal from the one being set up, so the name has to be
 * enterable even when this machine cannot see it.
 */
function PrinterPicker({
  id,
  label,
  placeholder,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  options: string[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id} style={{ flex: 1, minWidth: 200 }}>
      <input
        id={id}
        list={`${id}-options`}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={bareInput}
      />
      <datalist id={`${id}-options`}>
        {options.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {!disabled && options.length > 0 ? (
        <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
          {options.length} printer{options.length === 1 ? '' : 's'} detected — leave blank for the
          default
        </span>
      ) : null}
    </Field>
  );
}

/** A labelled settings row with the reasoning underneath it. */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>{label}</span>
      {hint ? (
        <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}>{hint}</span>
      ) : null}
      <div style={{ marginTop: 2 }}>{children}</div>
    </div>
  );
}

/** Bounded 1-5, matching the server. A typo'd 50 would empty a paper roll. */
function Counter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.58)', minWidth: 30 }}>
        {label}
      </span>
      <button
        type="button"
        className="press hv-neutral"
        onClick={() => onChange(Math.max(1, value - 1))}
        style={stepper}
      >
        −
      </button>
      <span style={{ minWidth: 18, textAlign: 'center', fontSize: 15, fontWeight: 700 }}>
        {value}
      </span>
      <button
        type="button"
        className="press hv-neutral"
        onClick={() => onChange(Math.min(5, value + 1))}
        style={stepper}
      >
        +
      </button>
    </span>
  );
}

/** A representative bill, so the preview shows wrapping and a discount. */
function previewHtml(settings: PrinterSettingsDraft): string {
  const now = new Date();
  return billHtml(
    {
      invoiceNo: 'INV-20260807-1042',
      orderNo: 1042,
      business: {
        name: settings.businessName || settings.effectiveName,
        address: settings.businessAddress,
        phone: settings.businessPhone,
        gstNumber: settings.gstNumber,
        footer: settings.footerLine || settings.effectiveFooter,
      },
      tableName: 'T5',
      customerName: 'Rahul',
      placedAt: now,
      paidAt: now,
      paymentMethod: 'cash',
      items: [
        { name: 'Paneer Butter Masala', qty: 2, note: '', unitPrice: 320, lineTotal: 640 },
        { name: 'Garlic Naan with extra butter', qty: 3, note: 'No onion', unitPrice: 70, lineTotal: 210 },
      ],
      subtotal: 850,
      discount: 50,
      tax: 0,
      taxRate: 0,
      total: 800,
    },
    settings.paperWidth,
  );
}

type PrinterSettingsDraft = ReturnType<typeof usePos>['state']['printerDraft'];

const secondaryPill: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 50,
  border: '1px solid #d6dbde',
  background: '#ffffff',
  color: 'rgba(0,0,0,0.87)',
  fontSize: 13,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  gap: 7,
};

const stepper: React.CSSProperties = {
  width: 30,
  height: 30,
  minHeight: 30,
  borderRadius: '50%',
  border: '1px solid #d6dbde',
  background: '#ffffff',
  fontSize: 16,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
