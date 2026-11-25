import { ArrowUpRight, CheckCircle2, Clock, ShieldCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import {
  formatMethodLabel,
  formatMicros,
  formatRelativeTime,
  triggerHaptic,
} from '../lib/telegram.ts';
import type { WalletResponse } from '../lib/types.ts';

interface WalletTabProps {
  data: WalletResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

export function WalletTab({ data, loading, onRefresh }: WalletTabProps) {
  const [method, setMethod] = useState<'telegram_stars' | 'ton_usdt' | 'upi'>('telegram_stars');
  const [payoutAddress, setPayoutAddress] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="h-32 rounded-2xl bg-[#111115] border border-white/10 animate-pulse" />
        <div className="h-64 rounded-2xl bg-[#111115] border border-white/10 animate-pulse" />
      </div>
    );
  }

  const { wallet, my_withdrawals, public_payouts } = data;
  const currency = wallet.currency_label || 'USDT';
  const minUnits = wallet.min_withdraw_micros / 1_000_000;
  const availableUnits = wallet.balance_micros / 1_000_000;
  const thresholdProgress = Math.min(
    100,
    wallet.min_withdraw_micros > 0
      ? Math.round((wallet.balance_micros / wallet.min_withdraw_micros) * 100)
      : 100
  );

  const addressPlaceholder =
    method === 'telegram_stars'
      ? '@your_telegram_username'
      : method === 'ton_usdt'
      ? 'UQ... TON / USDT (TRC20 or TON) wallet'
      : 'yourname@upi';

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    const parsed = Number(amountInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter a valid withdrawal amount.');
      return;
    }
    const amountMicros = Math.round(parsed * 1_000_000);
    if (amountMicros < wallet.min_withdraw_micros) {
      setError(`Minimum withdrawal is ${formatMicros(wallet.min_withdraw_micros, currency)}.`);
      return;
    }
    if (amountMicros > wallet.balance_micros) {
      setError('Requested amount exceeds your available balance.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/withdraw', {
        method: 'POST',
        body: {
          method,
          payout_address: payoutAddress.trim(),
          amount_micros: amountMicros,
        },
      });
      setSuccessMsg(res.message || 'Withdrawal request submitted.');
      setPayoutAddress('');
      setAmountInput('');
      triggerHaptic('success');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Withdrawal request failed.');
      triggerHaptic('error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Wallet Summary Strip */}
      <section className="bg-[#111115] border border-white/10 rounded-2xl overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/10">
          <div className="p-5">
            <p className="text-xs text-zinc-400">Available Balance</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
              {formatMicros(wallet.balance_micros, currency)}
            </p>
          </div>
          <div className="p-5">
            <p className="text-xs text-zinc-400">Pending Payout</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-amber-300 tabular-nums">
              {formatMicros(wallet.pending_micros, currency)}
            </p>
          </div>
          <div className="p-5">
            <p className="text-xs text-zinc-400">Total Paid Out</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-white tabular-nums">
              {formatMicros(wallet.total_paid_micros, currency)}
            </p>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-white/10 bg-white/[0.02]">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-zinc-400">
              Minimum payout threshold: <span className="font-mono text-zinc-200">{formatMicros(wallet.min_withdraw_micros, currency)}</span>
            </span>
            <span className="font-mono text-emerald-400 tabular-nums">{thresholdProgress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${thresholdProgress}%` }}
            />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Withdrawal Form + User's Withdrawal History */}
        <div className="lg:col-span-6 space-y-6">
          <form
            onSubmit={handleWithdraw}
            className="bg-[#111115] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-4"
          >
            <div>
              <h2 className="text-base font-semibold text-white">Request Payout</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                All payouts are reviewed against verified view logs and published to the public proof ledger upon completion.
              </p>
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
                {error}
              </div>
            )}
            {successMsg && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
                {successMsg}
              </div>
            )}

            <div>
              <span className="block text-xs font-medium text-zinc-300 mb-1.5">Payout Method</span>
              <div className="grid grid-cols-3 gap-1 p-1 bg-[#08080A] border border-white/10 rounded-xl">
                {(
                  [
                    ['telegram_stars', 'TG Stars'],
                    ['ton_usdt', 'TON / USDT'],
                    ['upi', 'UPI'],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setMethod(val)}
                    className={`min-h-[40px] rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      method === val
                        ? 'bg-emerald-500 text-zinc-950 font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="payout-addr" className="block text-xs font-medium text-zinc-300 mb-1.5">
                {method === 'telegram_stars'
                  ? 'Telegram Username'
                  : method === 'ton_usdt'
                  ? 'TON / USDT Wallet Address'
                  : 'UPI ID'}
              </label>
              <input
                id="payout-addr"
                type="text"
                required
                value={payoutAddress}
                onChange={(e) => setPayoutAddress(e.target.value)}
                placeholder={addressPlaceholder}
                className="w-full min-h-[46px] rounded-xl bg-[#08080A] border border-white/10 focus:border-emerald-500/60 focus:outline-none px-3.5 text-sm text-white placeholder:text-zinc-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="payout-amount" className="text-xs font-medium text-zinc-300">
                  Amount ({currency})
                </label>
                <button
                  type="button"
                  onClick={() => setAmountInput(availableUnits.toFixed(2))}
                  className="text-xs font-mono text-emerald-400 hover:text-emerald-300"
                >
                  Use Max ({availableUnits.toFixed(2)})
                </button>
              </div>
              <input
                id="payout-amount"
                type="number"
                step="0.01"
                min={minUnits}
                max={Math.max(minUnits, availableUnits)}
                required
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder={`Min ${minUnits.toFixed(2)}`}
                className="w-full min-h-[46px] rounded-xl bg-[#08080A] border border-white/10 focus:border-emerald-500/60 focus:outline-none px-3.5 font-mono text-sm text-white placeholder:text-zinc-500 tabular-nums"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || wallet.balance_micros < wallet.min_withdraw_micros}
              className="w-full min-h-[48px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-45 text-zinc-950 font-semibold text-sm transition-colors"
            >
              {submitting
                ? 'Submitting Request...'
                : wallet.balance_micros < wallet.min_withdraw_micros
                ? `Reach ${formatMicros(wallet.min_withdraw_micros, currency)} to Withdraw`
                : 'Submit Withdrawal Request'}
            </button>
          </form>

          {/* My Withdrawal History */}
          <section className="bg-[#111115] border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10">
              <h3 className="text-sm font-semibold text-white">Your Withdrawal History</h3>
            </div>
            {my_withdrawals.length === 0 ? (
              <p className="p-5 text-xs text-zinc-400">
                You have not submitted a withdrawal request yet.
              </p>
            ) : (
              <div className="divide-y divide-white/10">
                {my_withdrawals.map((w) => (
                  <div key={w.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-mono font-medium text-white tabular-nums">
                        {formatMicros(w.amount_micros, currency)}
                      </p>
                      <p className="text-xs text-zinc-400 truncate mt-0.5">
                        {formatMethodLabel(w.method)} · {w.payout_address}
                      </p>
                      {w.tx_proof && (
                        <p className="text-[11px] font-mono text-zinc-500 truncate mt-0.5">
                          {w.tx_proof}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="inline-flex items-center gap-1.5 text-xs font-medium">
                        {w.status === 'paid' && (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">Paid</span>
                          </>
                        )}
                        {w.status === 'pending' && (
                          <>
                            <Clock className="w-3.5 h-3.5 text-amber-300" />
                            <span className="text-amber-300">Pending</span>
                          </>
                        )}
                        {w.status === 'rejected' && (
                          <>
                            <XCircle className="w-3.5 h-3.5 text-red-400" />
                            <span className="text-red-400">Refunded</span>
                          </>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        {formatRelativeTime(w.processed_at || w.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Public Recent Payouts Proof Feed (AdsGram Required Transparency) */}
        <section className="lg:col-span-6 bg-[#111115] border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Public Payouts Proof</h3>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Real admin-verified creator payouts recorded automatically on approval.
              </p>
            </div>
            {wallet.payout_channel_url && (
              <a
                href={wallet.payout_channel_url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[36px] px-3 rounded-lg border border-white/10 hover:bg-white/5 text-xs font-medium text-emerald-400 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <span>Channel</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          {public_payouts.length === 0 ? (
            <p className="p-6 text-xs text-zinc-400">
              Verified creator payouts will appear here as soon as they are processed.
            </p>
          ) : (
            <div className="divide-y divide-white/10">
              {public_payouts.map((p) => (
                <div
                  key={p.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-white/[0.015] transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono font-medium text-white truncate">
                        {p.masked_user}
                      </span>
                      <span className="text-zinc-600" aria-hidden="true">·</span>
                      <span className="text-xs text-zinc-400 whitespace-nowrap">
                        {formatMethodLabel(p.method)}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-zinc-500 truncate mt-0.5">
                      {p.tx_proof || 'Admin verified transfer'}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-mono text-sm font-semibold text-emerald-400 tabular-nums">
                      {formatMicros(p.amount_micros, currency)}
                    </p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      {formatRelativeTime(p.paid_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
