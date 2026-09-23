import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreditCard, ShieldCheck, ExternalLink } from "lucide-react";
import { billingApi, type BillingSummary, type BillingPlan, type LedgerRow } from "../services/api";
import { Card, CardBody, CardHeader, Badge, Alert, EmptyState, Button, SkeletonCard } from "./ui";

/**
 * Read-only billing summary shown inside Settings (parent + teacher). It reads the SAME
 * canonical source as the full /billing page (billingApi.me + plans + ledger), so the
 * credit balance, plan and transactions always match everywhere they're shown.
 */
export default function BillingSummaryTab() {
  const navigate = useNavigate();
  const [me, setMe] = useState<BillingSummary | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    Promise.all([
      billingApi.me(),
      billingApi.plans().catch(() => ({ plans: [] as BillingPlan[], currency: "GBP" })),
      billingApi.ledger().catch(() => ({ entries: [] as LedgerRow[] })),
    ])
      .then(([m, p, l]) => { setMe(m); setPlans(p.plans); setLedger(l.entries); })
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <Card><CardBody><div className="t-helper">Billing isn't available for this account.</div></CardBody></Card>;
  if (!me) return <SkeletonCard lines={5} />;

  const sub = me.subscription;
  const currentPlan = plans.find((p) => p.slug === sub?.plan_slug);
  const portal = async () => { const r = await billingApi.portal(); if (r.url) window.location.href = r.url; };

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div className="grid sm:grid-cols-2 gap-4">
        <Card><CardBody>
          <div className="t-eyebrow">Credit balance</div>
          <div className="t-kpi mt-1">{me.balance.toFixed(0)}</div>
        </CardBody></Card>
        <Card><CardBody>
          <div className="t-eyebrow">Plan</div>
          {sub ? (
            <>
              <div className="t-card-title mt-1">{currentPlan?.name ?? sub.plan_slug}{" "}
                <Badge tone={sub.status === "active" ? "success" : sub.status === "past_due" ? "danger" : "neutral"}>{sub.status.replace("_", " ")}</Badge>
              </div>
              <div className="t-helper mt-0.5">
                {currentPlan ? `£${currentPlan.price.toFixed(2)}/${currentPlan.interval}` : ""}
                {sub.current_period_end ? ` · renews ${new Date(sub.current_period_end).toLocaleDateString()}` : ""}
                {sub.cancel_at_period_end ? " · cancels at period end" : ""}
              </div>
            </>
          ) : <div className="t-helper mt-1">No active subscription. Pay-as-you-go credits.</div>}
        </CardBody></Card>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" leftIcon={<CreditCard size={14} />} onClick={() => navigate("/billing")}>Manage billing &amp; plans</Button>
        <button onClick={portal} className="t-helper text-brand hover:underline flex items-center gap-1">Billing portal <ExternalLink size={12} /></button>
      </div>

      <Alert tone="info" title="Payment methods">
        <span className="flex items-center gap-2"><ShieldCheck size={15} className="text-brand shrink-0" />
          Card details are handled securely by our payment provider and never stored on our servers. Manage cards &amp; subscriptions from the billing portal.</span>
      </Alert>

      <Card>
        <CardHeader title="Recent transactions" />
        <CardBody className="pt-0">
          {ledger.length === 0 ? (
            <EmptyState icon={<CreditCard size={32} />} title="No transactions yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="text-left t-eyebrow border-b border-line">
                  <th className="py-2">Date</th><th>Description</th><th className="text-right">Change</th><th className="text-right">Balance</th>
                </tr></thead>
                <tbody>
                  {ledger.slice(0, 12).map((t, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="py-2 text-ink-muted whitespace-nowrap">{new Date(t.created_at).toLocaleDateString()}</td>
                      <td className="text-ink">{t.reason || t.entry_type}</td>
                      <td className={`text-right font-semibold ${t.delta >= 0 ? "text-success" : "text-ink"}`}>{t.delta >= 0 ? "+" : ""}{t.delta.toFixed(0)}</td>
                      <td className="text-right text-ink-muted">{t.balance_after.toFixed(0)}</td>
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
