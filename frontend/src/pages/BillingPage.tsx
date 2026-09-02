import { useCallback, useEffect, useState } from "react";
import { Check, CreditCard, AlertTriangle, Sparkles, ExternalLink, RefreshCw } from "lucide-react";
import Sidebar from "../components/Sidebar";
import {
  billingApi, type BillingPlan, type BillingSummary, type InvoiceRow, type LedgerRow,
} from "../services/api";
import {
  PageHeader, Card, CardBody, CardHeader, Button, Badge, Alert, Spinner, EmptyState,
} from "../components/ui";

function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="fixed bottom-5 right-5 z-30 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-ink text-white shadow-lg text-[13px] font-semibold"><Check size={15} /> {msg}</div>;
}
const money = (n: number, c = "GBP") => new Intl.NumberFormat("en-GB", { style: "currency", currency: c }).format(n);

export default function BillingPage() {
  const [me, setMe] = useState<BillingSummary | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2600); };

  const load = useCallback(async () => {
    const [m, p, inv, led] = await Promise.all([
      billingApi.me(), billingApi.plans(), billingApi.invoices(), billingApi.ledger(),
    ]);
    setMe(m); setPlans(p.plans); setInvoices(inv.invoices); setLedger(led.entries);
  }, []);
  useEffect(() => { load().catch(() => setMe(null)); }, [load]);

  const subscribe = async (slug: string) => {
    setBusy(slug);
    try {
      const res = await billingApi.subscribe(slug);
      if (res.url) { window.location.href = res.url; return; }         // real Stripe Checkout
      await billingApi.devComplete("subscription", slug);              // dev/mock: replay webhooks
      await load(); flash("Subscription active");
    } catch (e) { flash(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(null); }
  };
  const cancel = async () => {
    if (!window.confirm("Cancel at the end of the current period? You keep access until then.")) return;
    setBusy("cancel"); try { await billingApi.cancel(true); await load(); flash("Will cancel at period end"); } finally { setBusy(null); }
  };
  const reactivate = async () => { setBusy("react"); try { await billingApi.reactivate(); await load(); flash("Subscription reactivated"); } finally { setBusy(null); } };
  const portal = async () => {
    const r = await billingApi.portal();
    if (r.url) window.location.href = r.url; else flash("Billing portal is available in live mode");
  };

  if (!me) return <div className="app-layout"><Sidebar /><div className="main-content"><div className="dashboard-content flex justify-center py-16"><Spinner /></div></div></div>;

  const sub = me.subscription;
  const currentPlan = plans.find((p) => p.slug === sub?.plan_slug);

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content" style={{ padding: "24px 28px", overflowY: "auto" }}>
          <PageHeader title="Billing & plans"
            subtitle="Manage your subscription and credits."
            actions={me.mock_mode ? <Badge tone="warning">Test mode</Badge> : undefined} />

          {sub?.status === "past_due" && (
            <div className="mb-4"><Alert tone="danger" title="Payment issue">
              <span className="flex items-center gap-2"><AlertTriangle size={15} className="shrink-0" />
                Your last payment failed. Update your payment method to keep your subscription active.
                <Button size="sm" variant="danger" onClick={portal}>Update payment method</Button></span>
            </Alert></div>
          )}
          {sub?.cancel_at_period_end && sub.current_period_end && (
            <div className="mb-4"><Alert tone="warning">
              Your subscription ends on {new Date(sub.current_period_end).toLocaleDateString()}. You can reactivate any time before then.
            </Alert></div>
          )}

          {/* Summary */}
          <div className="grid sm:grid-cols-3 gap-4 mb-6">
            <Card><CardBody>
              <div className="t-eyebrow">Credit balance</div>
              <div className="t-kpi mt-1">{me.balance.toFixed(0)}</div>
            </CardBody></Card>
            <Card><CardBody>
              <div className="t-eyebrow">Current plan</div>
              {sub ? <>
                <div className="t-card-title mt-1">{currentPlan?.name ?? sub.plan_slug}</div>
                <div className="t-helper mt-0.5"><Badge tone={sub.status === "active" ? "success" : sub.status === "past_due" ? "danger" : "neutral"}>{sub.status.replace("_", " ")}</Badge>
                  {sub.current_period_end ? ` · renews ${new Date(sub.current_period_end).toLocaleDateString()}` : ""}</div>
              </> : <div className="t-helper mt-1">No active plan — pay as you go.</div>}
            </CardBody></Card>
            <Card><CardBody>
              <div className="t-eyebrow">Payment method</div>
              {me.payment_method?.last4 ? (
                <div className="t-card-title mt-1 flex items-center gap-2"><CreditCard size={16} /> {me.payment_method.brand} ···· {me.payment_method.last4}</div>
              ) : <div className="t-helper mt-1">Added securely at checkout.</div>}
              <button onClick={portal} className="t-helper text-brand mt-1 hover:underline flex items-center gap-1">Manage <ExternalLink size={12} /></button>
            </CardBody></Card>
          </div>

          {/* Plans */}
          <h2 className="t-section mb-3">{sub ? "Change plan" : "Choose a plan"}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {plans.map((p) => {
              const current = p.slug === sub?.plan_slug && !sub?.cancel_at_period_end;
              return (
                <Card key={p.slug} className={current ? "ring-2 ring-brand" : ""}>
                  <CardBody className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="t-card-title">{p.name}</span>
                      {current && <Badge tone="success">Current</Badge>}
                    </div>
                    <div className="t-kpi">{money(p.price)}<span className="t-helper font-normal">/mo</span></div>
                    <div className="t-helper flex items-center gap-1"><Sparkles size={13} className="text-brand" /> {p.credits_per_period.toLocaleString()} credits / month</div>
                    <div className="t-helper">{p.description}</div>
                    <Button className="mt-2" disabled={current} loading={busy === p.slug}
                      variant={current ? "secondary" : "primary"} onClick={() => subscribe(p.slug)}>
                      {current ? "Active" : sub ? "Switch to this" : "Subscribe"}
                    </Button>
                  </CardBody>
                </Card>
              );
            })}
          </div>

          {/* Manage */}
          {sub && (
            <div className="flex flex-wrap gap-2 mb-6">
              {sub.cancel_at_period_end
                ? <Button variant="success" leftIcon={<RefreshCw size={15} />} loading={busy === "react"} onClick={reactivate}>Reactivate subscription</Button>
                : <Button variant="outline" loading={busy === "cancel"} onClick={cancel}>Cancel subscription</Button>}
              <Button variant="ghost" leftIcon={<ExternalLink size={15} />} onClick={portal}>Billing portal</Button>
            </div>
          )}

          {/* Invoices */}
          <Card className="mb-6">
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
                          <td className="text-right">{inv.hosted_invoice_url && <a className="text-brand hover:underline" href={inv.hosted_invoice_url} target="_blank" rel="noreferrer">View</a>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Credit activity */}
          <Card>
            <CardHeader title="Credit activity" />
            <CardBody className="pt-0">
              {ledger.length === 0 ? <EmptyState icon={<Sparkles size={30} />} title="No credit activity yet" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead><tr className="text-left t-eyebrow border-b border-line">
                      <th className="py-2">Date</th><th>Description</th><th>Type</th><th className="text-right">Change</th><th className="text-right">Balance</th>
                    </tr></thead>
                    <tbody>
                      {ledger.map((e, i) => (
                        <tr key={i} className="border-b border-line last:border-0">
                          <td className="py-2 text-ink-muted whitespace-nowrap">{new Date(e.created_at).toLocaleDateString()}</td>
                          <td className="text-ink">{e.reason || e.source}</td>
                          <td><Badge tone="neutral">{e.entry_type}</Badge></td>
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
      </div>
      <Toast msg={toast} />
    </div>
  );
}
