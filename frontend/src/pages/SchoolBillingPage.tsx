import { useCallback, useEffect, useState } from "react";
import {
  Check, Wallet, Sparkles, Download, CreditCard, Plus, RefreshCw, ExternalLink,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import {
  billingApi, schoolBillingApi, adminSettingsApi,
  type BillingSummary, type BillingPlan, type TokenPackage, type InvoiceRow, type LedgerRow,
  type TopupRequest, type SchoolBillingSettings, type Offering,
} from "../services/api";
import {
  PageHeader, Card, CardBody, CardHeader, Button, Badge, Alert, Spinner, EmptyState,
  Input, FormField, Select, Tabs,
} from "../components/ui";
import { MemberFundingCard } from "./BillingPage";

const TABS = [
  { key: "wallet", label: "Wallet" },
  { key: "members", label: "Distribute credits" },
  { key: "subscribe", label: "Buy & Subscribe" },
  { key: "topups", label: "Top-ups" },
  { key: "manage", label: "Plans & top-ups" },
  { key: "invoices", label: "Invoices" },
  { key: "settings", label: "Settings" },
];
const money = (n: number, c = "GBP") => new Intl.NumberFormat("en-GB", { style: "currency", currency: c }).format(n);
function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="fixed bottom-5 right-5 z-30 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-ink text-white shadow-lg text-[13px] font-semibold"><Check size={15} /> {msg}</div>;
}

export default function SchoolBillingPage() {
  const [tab, setTab] = useState("wallet");
  const [me, setMe] = useState<BillingSummary | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2600); };
  const refreshMe = useCallback(() => billingApi.me().then(setMe).catch(() => setMe(null)), []);
  useEffect(() => { refreshMe(); }, [refreshMe]);

  // The school's payment model hides the tab it doesn't use.
  const model = me?.payment_model ?? "hybrid";
  const visibleTabs = TABS.filter((t) =>
    (t.key !== "subscribe" || model !== "token_topup") &&
    (t.key !== "topups" || model !== "subscription"));

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content" style={{ padding: "24px 28px", overflowY: "auto" }}>
          <PageHeader title="School billing" subtitle="Wallet, plans, top-ups and invoices for your school."
            actions={me?.mock_mode ? <Badge tone="warning">Test mode</Badge> : undefined} />
          <div className="mb-5"><Tabs items={visibleTabs} active={tab} onChange={setTab} /></div>
          {tab === "wallet" && <WalletTab flash={flash} />}
          {tab === "members" && (
            <div className="max-w-4xl">
              <p className="t-helper mb-3">Send credits from your school wallet to teachers, parents and students. Each transfer is deducted from the school wallet and recorded in the ledger.</p>
              <MemberFundingCard flash={flash} onChange={refreshMe} />
            </div>
          )}
          {tab === "subscribe" && <SubscribeTab me={me} refreshMe={refreshMe} flash={flash} />}
          {tab === "topups" && <TopupsTab flash={flash} onChange={refreshMe} />}
          {tab === "manage" && <ManageTab flash={flash} refreshMe={refreshMe} model={model} />}
          {tab === "invoices" && <InvoicesTab />}
          {tab === "settings" && <SettingsTab flash={flash} />}
        </div>
      </div>
      <Toast msg={toast} />
    </div>
  );
}

/* ── Wallet ─────────────────────────────────────────────────────────────── */
function WalletTab({ flash }: { flash: (m: string) => void }) {
  const [data, setData] = useState<{ balance: number; entries: LedgerRow[] } | null>(null);
  const [filter, setFilter] = useState("");
  const [credit, setCredit] = useState({ amount: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => billingApi.ledger(filter || undefined).then(setData).catch(() => setData(null)), [filter]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Spinner />;

  const applyCredit = async (sign: 1 | -1) => {
    const amt = parseFloat(credit.amount);
    if (!amt || amt <= 0 || credit.reason.trim().length < 3) return flash("Enter an amount and a reason (3+ chars)");
    setBusy(true);
    try {
      if (sign > 0) await schoolBillingApi.manualCredit(amt, credit.reason);
      else await schoolBillingApi.refund(amt, credit.reason);
      setCredit({ amount: "", reason: "" }); await load(); flash(sign > 0 ? "Credit applied" : "Refund applied");
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <div className="grid sm:grid-cols-2 gap-4">
        <Card><CardBody>
          <div className="t-eyebrow flex items-center gap-1"><Wallet size={13} /> Balance</div>
          <div className="t-kpi mt-1">{data.balance.toFixed(0)}<span className="t-helper font-normal"> credits</span></div>
        </CardBody></Card>
        <Card><CardBody>
          <div className="t-card-title mb-2">Adjust balance</div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {[50, 100, 250, 500, 1000].map((n) => (
                <button key={n} type="button" onClick={() => setCredit({ ...credit, amount: String(n) })} aria-pressed={credit.amount === String(n)}
                  className={`px-2.5 py-1 rounded-full border text-[12px] font-semibold transition-colors ${credit.amount === String(n) ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink hover:border-brand"}`}>
                  {n}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input type="number" placeholder="Amount" value={credit.amount} onChange={(e) => setCredit({ ...credit, amount: e.target.value })} />
            </div>
            <Input placeholder="Reason (required, audited)" value={credit.reason} onChange={(e) => setCredit({ ...credit, reason: e.target.value })} />
            <div className="flex gap-2">
              <Button size="sm" loading={busy} onClick={() => applyCredit(1)}>Add credit</Button>
              <Button size="sm" variant="outline" loading={busy} onClick={() => applyCredit(-1)}>Refund</Button>
            </div>
          </div>
        </CardBody></Card>
      </div>

      <Card>
        <CardHeader title="Ledger" actions={
          <div className="flex items-center gap-2">
            <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="!h-9 text-[13px]">
              <option value="">All types</option>
              {["subscription", "topup", "manual", "refund"].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
            <Button size="sm" variant="ghost" leftIcon={<Download size={14} />} onClick={() => schoolBillingApi.downloadLedgerCsv().catch(() => flash("Export failed"))}>CSV</Button>
          </div>
        } />
        <CardBody className="pt-0">
          {data.entries.length === 0 ? <EmptyState icon={<Wallet size={30} />} title="No transactions yet" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="text-left t-eyebrow border-b border-line">
                  <th className="py-2">Date</th><th>Type</th><th>Reference</th><th>Reason</th><th className="text-right">Change</th><th className="text-right">Balance</th>
                </tr></thead>
                <tbody>
                  {data.entries.map((e, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="py-2 text-ink-muted whitespace-nowrap">{new Date(e.created_at).toLocaleDateString()}</td>
                      <td><Badge tone="neutral">{e.entry_type}</Badge></td>
                      <td className="text-ink-muted truncate max-w-[140px]">{e.reference ?? "—"}</td>
                      <td className="text-ink-muted">{e.reason || "—"}</td>
                      <td className={`text-right font-semibold ${e.delta >= 0 ? "text-success" : "text-danger"}`}>{e.delta >= 0 ? "+" : ""}{e.delta.toFixed(0)}</td>
                      <td className="text-right text-ink-muted">{e.balance_after.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/* ── Subscribe ──────────────────────────────────────────────────────────── */
function SubscribeTab({ me, refreshMe, flash }: { me: BillingSummary | null; refreshMe: () => Promise<void>; flash: (m: string) => void }) {
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { billingApi.plans().then((p) => setPlans(p.plans)).catch(() => setPlans([])); }, []);
  const sub = me?.subscription;

  const subscribe = async (slug: string) => {
    setBusy(slug);
    try {
      const res = await billingApi.subscribe(slug);
      if (res.url) { window.location.href = res.url; return; }
      await billingApi.devComplete("subscription", slug); await refreshMe(); flash("Subscription active");
    } catch (e) { flash(e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); }
  };
  const cancel = async () => { if (!window.confirm("Cancel at period end?")) return; await billingApi.cancel(true); await refreshMe(); flash("Will cancel at period end"); };
  const reactivate = async () => { await billingApi.reactivate(); await refreshMe(); flash("Reactivated"); };

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      {sub?.cancel_at_period_end && sub.current_period_end && (
        <Alert tone="warning">Subscription ends {new Date(sub.current_period_end).toLocaleDateString()}. Reactivate any time before then.</Alert>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        {plans.map((p) => {
          const current = p.slug === sub?.plan_slug && !sub?.cancel_at_period_end;
          return (
            <Card key={p.slug} className={current ? "ring-2 ring-brand" : ""}>
              <CardBody className="flex flex-col gap-2">
                <div className="flex items-center justify-between"><span className="t-card-title">{p.name}</span>{current && <Badge tone="success">Current</Badge>}</div>
                <div className="t-kpi">{money(p.price)}<span className="t-helper font-normal">/mo</span></div>
                <div className="t-helper flex items-center gap-1"><Sparkles size={13} className="text-brand" /> {p.credits_per_period.toLocaleString()} credits / month</div>
                <div className="t-helper">{p.description}</div>
                <Button className="mt-2" disabled={current} loading={busy === p.slug} variant={current ? "secondary" : "primary"} onClick={() => subscribe(p.slug)}>
                  {current ? "Active" : sub ? "Switch to this" : "Subscribe"}
                </Button>
              </CardBody>
            </Card>
          );
        })}
      </div>
      {sub && (
        <div className="flex gap-2">
          {sub.cancel_at_period_end
            ? <Button variant="success" leftIcon={<RefreshCw size={15} />} onClick={reactivate}>Reactivate</Button>
            : <Button variant="outline" onClick={cancel}>Cancel subscription</Button>}
        </div>
      )}
    </div>
  );
}

/* ── Top-ups ────────────────────────────────────────────────────────────── */
function TopupsTab({ flash, onChange }: { flash: (m: string) => void; onChange: () => Promise<void> }) {
  const [packages, setPackages] = useState<TokenPackage[]>([]);
  const [requests, setRequests] = useState<TopupRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [p, r] = await Promise.all([billingApi.packages(), schoolBillingApi.requests().catch(() => ({ requests: [] }))]);
    setPackages(p.packages); setRequests(r.requests);
  }, []);
  useEffect(() => { load(); }, [load]);

  const buy = async (slug: string) => {
    setBusy(slug);
    try {
      const res = await billingApi.topup(slug);
      if (res.url) { window.location.href = res.url; return; }
      await billingApi.devComplete("topup", slug); await load(); await onChange(); flash("Credits added");
    } catch (e) { flash(e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); }
  };
  const decide = async (id: number, approve: boolean) => {
    if (approve) await schoolBillingApi.approve(id); else await schoolBillingApi.decline(id);
    await load(); await onChange(); flash(approve ? "Approved" : "Declined");
  };

  const pending = requests.filter((r) => r.status === "pending");
  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <h2 className="t-section">Buy credits</h2>
      <div className="grid sm:grid-cols-3 gap-4">
        {packages.map((p) => (
          <Card key={p.slug}>
            <CardBody className="flex flex-col gap-1.5">
              <span className="t-card-title">{p.name}</span>
              <div className="t-kpi">{p.credits.toLocaleString()}<span className="t-helper font-normal"> cr</span></div>
              <div className="t-helper">{money(p.price)} · {p.description}</div>
              <Button className="mt-2" size="sm" loading={busy === p.slug} onClick={() => buy(p.slug)}>Buy</Button>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Top-up requests" subtitle="Requests from staff awaiting your approval." />
        <CardBody className="pt-0">
          {pending.length === 0 ? <EmptyState icon={<Plus size={28} />} title="No pending requests" /> : pending.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-line last:border-0">
              <div>
                <div className="t-body font-semibold text-ink">{r.package_slug} · {r.credits.toLocaleString()} credits</div>
                <div className="t-helper">{money(r.amount)}{r.note ? ` · "${r.note}"` : ""}</div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="success" onClick={() => decide(r.id, true)}>Approve & buy</Button>
                <Button size="sm" variant="ghost" onClick={() => decide(r.id, false)}>Decline</Button>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

/* ── Invoices ───────────────────────────────────────────────────────────── */
function InvoicesTab() {
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  useEffect(() => { billingApi.invoices().then((r) => setInvoices(r.invoices)).catch(() => setInvoices([])); }, []);
  if (!invoices) return <Spinner />;
  return (
    <Card className="max-w-4xl">
      <CardHeader title="Invoices" />
      <CardBody className="pt-0">
        {invoices.length === 0 ? <EmptyState icon={<CreditCard size={30} />} title="No invoices yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left t-eyebrow border-b border-line">
                <th className="py-2">Invoice</th><th>Date</th><th>Status</th><th className="text-right">Amount</th><th></th>
              </tr></thead>
              <tbody>
                {invoices.map((inv, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="py-2 font-medium text-ink">{inv.number ?? "—"}</td>
                    <td className="text-ink-muted">{inv.paid_at ? new Date(inv.paid_at).toLocaleDateString() : new Date(inv.created_at).toLocaleDateString()}</td>
                    <td><Badge tone={inv.status === "paid" ? "success" : "warning"}>{inv.status}</Badge></td>
                    <td className="text-right text-ink">{money(inv.amount_total, inv.currency)}</td>
                    <td className="text-right">{inv.hosted_invoice_url && <a className="text-brand hover:underline flex items-center gap-1 justify-end" href={inv.hosted_invoice_url} target="_blank" rel="noreferrer">View <ExternalLink size={12} /></a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ── Settings ───────────────────────────────────────────────────────────── */
function SettingsTab({ flash }: { flash: (m: string) => void }) {
  const [s, setS] = useState<SchoolBillingSettings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { schoolBillingApi.settings().then(setS).catch(() => setS(null)); }, []);
  if (!s) return <Spinner />;
  const save = async () => {
    setSaving(true);
    try { await schoolBillingApi.updateSettings({ billing_contact_email: s.billing_contact_email ?? "", billing_address: s.billing_address ?? "" }); flash("Billing settings saved"); }
    finally { setSaving(false); }
  };
  const saveFin = async (key: string, value: unknown) => {
    try { await adminSettingsApi.update(key, value, "school financial setting"); flash("Saved"); }
    catch (e) { flash(e instanceof Error ? e.message : "Couldn't save"); }
  };
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <Card>
        <CardHeader title="Financial settings" subtitle="Currency, tax and invoice prefix for your school. (Your payment model is set under Plans & top-ups.)" />
        <CardBody className="pt-0 grid sm:grid-cols-3 gap-3">
          <FormField label="Currency">
            <Select value={s.currency} onChange={(e) => { setS({ ...s, currency: e.target.value }); saveFin("currency", e.target.value); }}>
              {["GBP", "USD", "EUR", "AED"].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </FormField>
          <FormField label="Tax rate (%)">
            <Input type="number" value={String(s.tax_rate_percent)}
              onChange={(e) => setS({ ...s, tax_rate_percent: parseFloat(e.target.value || "0") })}
              onBlur={(e) => saveFin("tax_rate_percent", parseFloat(e.target.value || "0"))} />
          </FormField>
          <FormField label="Invoice prefix">
            <Input value={s.invoice_prefix}
              onChange={(e) => setS({ ...s, invoice_prefix: e.target.value })}
              onBlur={(e) => saveFin("invoice_prefix", e.target.value)} />
          </FormField>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Billing contact" subtitle="Where invoices and billing notices go." />
        <CardBody className="pt-0 flex flex-col gap-3">
          <FormField label="Billing contact email"><Input value={s.billing_contact_email ?? ""} onChange={(e) => setS({ ...s, billing_contact_email: e.target.value })} /></FormField>
          <FormField label="Billing address">
            <textarea value={s.billing_address ?? ""} onChange={(e) => setS({ ...s, billing_address: e.target.value })}
              className="w-full min-h-[70px] p-2.5 rounded-lg border border-line bg-surface text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand/40 resize-y" />
          </FormField>
          <div><Button onClick={save} loading={saving}>Save</Button></div>
        </CardBody>
      </Card>
    </div>
  );
}

/* ── Manage plans & top-ups + payment model ─────────────────────────────── */
function ManageTab({ flash, refreshMe, model }: { flash: (m: string) => void; refreshMe: () => Promise<void>; model: string }) {
  const [cat, setCat] = useState<{ plans: Offering[]; topups: Offering[]; is_platform_admin: boolean } | null>(null);
  const [savingModel, setSavingModel] = useState(false);
  const load = useCallback(() => billingApi.offerings().then(setCat).catch(() => setCat(null)), []);
  useEffect(() => { load(); }, [load]);

  const setModel = async (m: string) => {
    setSavingModel(true);
    try { await billingApi.setPaymentModel(m); await refreshMe(); flash("Payment model updated"); }
    catch (e) { flash(e instanceof Error ? e.message : "Failed"); } finally { setSavingModel(false); }
  };

  if (!cat) return <Spinner />;
  const MODELS: [string, string][] = [["hybrid", "Hybrid (both)"], ["subscription", "Plans only"], ["token_topup", "Top-ups only"]];
  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <Card>
        <CardHeader title="Payment model" subtitle="Choose how your school pays for credits." />
        <CardBody className="pt-0 flex flex-wrap gap-2">
          {MODELS.map(([k, label]) => (
            <button key={k} type="button" disabled={savingModel} onClick={() => setModel(k)} aria-pressed={model === k}
              className={`px-3.5 py-2 rounded-full border text-[13px] font-semibold transition-colors disabled:opacity-60 ${model === k ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink hover:border-brand"}`}>
              {label}
            </button>
          ))}
        </CardBody>
      </Card>

      <OfferingManager kind="plan" title="Subscription plans" items={cat.plans} onChange={load} flash={flash} />
      <OfferingManager kind="topup" title="Top-up packs" items={cat.topups} onChange={load} flash={flash} />
    </div>
  );
}

function OfferingManager({ kind, title, items, onChange, flash }: {
  kind: "plan" | "topup"; title: string; items: Offering[]; onChange: () => Promise<void>; flash: (m: string) => void;
}) {
  const [draft, setDraft] = useState({ name: "", price: "", credits: "" });
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const price = parseFloat(draft.price), credits = parseInt(draft.credits, 10);
    if (!draft.name.trim() || isNaN(price) || isNaN(credits)) { flash("Fill in a name, price and credits"); return; }
    setBusy(true);
    try {
      await billingApi.createOffering({ kind, name: draft.name.trim(), price, credits, interval: kind === "plan" ? "month" : null });
      setDraft({ name: "", price: "", credits: "" }); await onChange(); flash("Added");
    } catch (e) { flash(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  };
  const remove = async (o: Offering) => {
    if (o.id == null) return;
    if (!window.confirm(`Remove "${o.name}"?`)) return;
    try { await billingApi.deleteOffering(o.id); await onChange(); flash("Removed"); }
    catch (e) { flash(e instanceof Error ? e.message : "Failed"); }
  };
  return (
    <Card>
      <CardHeader title={title} subtitle="Platform offerings apply to every school; ones you add here are your school's own." />
      <CardBody className="pt-0 flex flex-col gap-1.5">
        {items.filter((o) => o.active).map((o) => (
          <div key={o.slug} className="flex items-center justify-between gap-3 py-2 border-b border-line last:border-0">
            <div className="min-w-0">
              <div className="t-body font-semibold text-ink flex items-center gap-2">
                {o.name}{o.school_id == null && <Badge tone="neutral">platform</Badge>}
              </div>
              <div className="t-helper">{money(o.price)}{kind === "plan" ? "/mo" : ""} · {o.credits.toLocaleString()} credits</div>
            </div>
            {o.id != null && o.school_id != null && (
              <Button size="sm" variant="ghost" onClick={() => remove(o)}>Remove</Button>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2 pt-3">
          <FormField label="Name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={kind === "plan" ? "e.g. Department" : "e.g. Booster"} /></FormField>
          <FormField label="Price (£)"><Input type="number" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></FormField>
          <FormField label="Credits"><Input type="number" value={draft.credits} onChange={(e) => setDraft({ ...draft, credits: e.target.value })} /></FormField>
          <Button size="sm" loading={busy} leftIcon={<Plus size={14} />} onClick={create}>Add {kind === "plan" ? "plan" : "pack"}</Button>
        </div>
      </CardBody>
    </Card>
  );
}
