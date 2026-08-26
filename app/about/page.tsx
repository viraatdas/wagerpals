// The "how does this actually work" page. Its job is to make the money model
// legible to someone who has never placed a bet here: where a stake goes when
// you place it, who is holding it while the bet is open, and how it gets to
// the winner. Those are the questions people ask before they trust an app with
// a card, and the answer is easier to show moving than to write down.
//
// Every colour, radius, shadow and duration comes from the tokens in
// globals.css (CLAUDE.md §8, tokens-only). The animations are pure CSS
// keyframes over those variables — no canvas, no animation library, nothing
// that ships a runtime — and the whole file collapses to static diagrams
// under prefers-reduced-motion.
//
// Deliberately a SERVER component. There is no state and no event handler
// here, so marking it 'use client' bought nothing and cost the whole page:
// combined with Stack Auth's suspendIfSsr() in the root layout it deopted
// /about into client-side rendering, which is the wrong trade for the one
// page a search engine or an App Review reader is most likely to load cold.

import Link from 'next/link';

export const metadata = {
  title: 'How WagerPals works',
  description:
    'Where your stake goes when you place a bet, who holds it while the bet is open, and how the pot reaches the winner.',
};

export default function AboutPage() {
  return (
    <div className="page-shell-narrow py-10 sm:py-16">
      <style>{CSS}</style>

      <header className="mb-14">
        <p className="eyebrow-accent mb-3">How it works</p>
        <h1 className="text-3xl sm:text-4xl font-semibold text-ink leading-tight mb-4">
          Your friends already argue about this.
          <br />
          WagerPals just keeps score and holds the money.
        </h1>
        <p className="lede max-w-2xl">
          Make a bet with people you know, put real dollars behind it, and let the app
          settle up when the answer is in. No bookmaker, no odds against the house —
          just the pot your group put in, going to whoever called it right.
        </p>
      </header>

      {/* ---------------------------------------------------------------- */}
      <Step
        n={1}
        title="Pick a side"
        body="Someone poses a question with two answers. Everyone who wants in picks a side and names their stake. The bar is just the money: which way the group is leaning, and by how much."
      >
        <SplitBarDemo />
      </Step>

      {/* ---------------------------------------------------------------- */}
      <Step
        n={2}
        title="The stake leaves your balance immediately"
        body="This is the part people get wrong about betting apps. Your stake is not an IOU — the moment you take a side, that money moves out of your spendable balance and into escrow, where nobody can touch it. Not you, not the other players, not us."
      >
        <EscrowDemo />
      </Step>

      {/* ---------------------------------------------------------------- */}
      <Step
        n={3}
        title="Settlement pays the pot out in one move"
        body="When the bet is resolved, every stake in escrow is released at once and split across the winning side in proportion to what each person risked. Bet twice as much, take twice as much home. If a bet is called off instead, every stake goes straight back to whoever put it in."
      >
        <SettlementDemo />
      </Step>

      {/* ---------------------------------------------------------------- */}
      <Step
        n={4}
        title="Money comes in by card, and leaves the same way"
        body="Deposits are ordinary card payments. Withdrawals are refunds against those same payments, which is why cashing out lands back on the card you paid with. It also means the $10 we give you to start, and anything you win off your friends, stays in the app as money to bet with rather than becoming cash."
      >
        <MoneyLoopDemo />
      </Step>

      <section className="card p-6 sm:p-8 mt-16">
        <h2 className="text-xl font-semibold text-ink mb-3">The short version</h2>
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Fact term="Who holds the stakes" def="Escrow, from the moment a bet is placed until it is resolved. A stake is never in someone else's balance while the bet is open." />
          <Fact term="Where the winnings come from" def="Only the pot your group put in. There is no house taking the other side of your bet." />
          <Fact term="What a tie or a cancelled bet does" def="Every stake is refunded in full to the person who placed it." />
          <Fact term="What you can withdraw" def="Up to what you have paid in by card and not already taken out. Winnings above that stay in your wallet." />
        </dl>
      </section>

      <p className="text-sm text-ink-muted mt-10">
        Questions about your account or your money?{' '}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-ink">
          Read the privacy policy
        </Link>{' '}
        or write to us at the address listed there.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* layout bits                                                         */

function Step({ n, title, body, children }: { n: number; title: string; body: string; children: React.ReactNode }) {
  return (
    <section className="mb-16 sm:mb-20">
      <div className="flex items-baseline gap-3 mb-2">
        <span className="numeral text-sm text-ink-muted tabular-nums">{String(n).padStart(2, '0')}</span>
        <h2 className="text-xl sm:text-2xl font-semibold text-ink">{title}</h2>
      </div>
      <p className="text-ink-secondary max-w-2xl mb-6 leading-relaxed">{body}</p>
      <div className="panel p-5 sm:p-7 overflow-hidden">{children}</div>
    </section>
  );
}

function Fact({ term, def }: { term: string; def: string }) {
  return (
    <div>
      <dt className="text-sm font-medium text-ink mb-1">{term}</dt>
      <dd className="text-sm text-ink-secondary leading-relaxed">{def}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1 — the split bar                                                   */

function SplitBarDemo() {
  return (
    <div className="wp-demo">
      <div className="flex items-center justify-between mb-3 text-sm">
        <span className="text-ink font-medium">Does Sam show up before 9?</span>
        <span className="numeral text-ink-muted tabular-nums">$85 in play</span>
      </div>
      <div className="wp-bar" aria-hidden="true">
        <div className="wp-bar-yes" />
        <div className="wp-bar-no" />
      </div>
      <div className="flex items-center justify-between mt-3 text-sm">
        <span className="tone-yes font-medium">Yes · $55</span>
        <span className="tone-no font-medium">No · $30</span>
      </div>
      <p className="sr-only">
        A bar showing 65 percent of the money on Yes and 35 percent on No.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2 — stakes moving into escrow and locking                           */

function EscrowDemo() {
  return (
    <div className="wp-demo">
      <div className="wp-escrow" aria-hidden="true">
        <div className="wp-purse wp-purse-a">
          <span className="wp-purse-label">Ana</span>
          <span className="numeral wp-purse-amt">$30</span>
        </div>
        <div className="wp-purse wp-purse-b">
          <span className="wp-purse-label">Ben</span>
          <span className="numeral wp-purse-amt">$25</span>
        </div>

        <div className="wp-vault">
          <div className="wp-vault-shackle" />
          <div className="wp-vault-body">
            <span className="wp-vault-label">Escrow</span>
            <span className="numeral wp-vault-amt">$55</span>
          </div>
        </div>

        <span className="wp-coin wp-coin-1" />
        <span className="wp-coin wp-coin-2" />
        <span className="wp-coin wp-coin-3" />
        <span className="wp-coin wp-coin-4" />
      </div>
      <p className="text-sm text-ink-muted mt-4">
        While the bet is open, that $55 belongs to the bet — not to Ana, not to Ben, not to us.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3 — settlement                                                      */

function SettlementDemo() {
  return (
    <div className="wp-demo">
      <div className="wp-settle" aria-hidden="true">
        <div className="wp-pot">
          <span className="wp-pot-label">Pot</span>
          <span className="numeral wp-pot-amt">$85</span>
        </div>

        <div className="wp-winners">
          <div className="wp-winner wp-winner-1">
            <div className="wp-winner-row">
              <span className="wp-winner-name">Ana</span>
              <span className="numeral wp-winner-amt tone-win">+$46.36</span>
            </div>
            <div className="wp-winner-track"><i /></div>
            <span className="wp-winner-note">staked $30 of the $55 on Yes</span>
          </div>
          <div className="wp-winner wp-winner-2">
            <div className="wp-winner-row">
              <span className="wp-winner-name">Cal</span>
              <span className="numeral wp-winner-amt tone-win">+$38.64</span>
            </div>
            <div className="wp-winner-track"><i /></div>
            <span className="wp-winner-note">staked $25 of the $55 on Yes</span>
          </div>
          <div className="wp-winner wp-winner-3">
            <div className="wp-winner-row">
              <span className="wp-winner-name">Ben</span>
              <span className="numeral wp-winner-amt tone-loss">−$30.00</span>
            </div>
            <div className="wp-winner-track wp-winner-track-loss"><i /></div>
            <span className="wp-winner-note">was on No</span>
          </div>
        </div>
      </div>
      <p className="text-sm text-ink-muted mt-4">
        The pot is split by share of the winning side, so nobody needs to agree on odds up front.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 4 — the money round trip                                            */

function MoneyLoopDemo() {
  const stops = [
    { key: 'card', label: 'Your card', sub: 'deposit' },
    { key: 'wallet', label: 'Wallet', sub: 'spendable' },
    { key: 'escrow', label: 'Escrow', sub: 'bet is open' },
    { key: 'back', label: 'Wallet', sub: 'settled' },
    { key: 'out', label: 'Your card', sub: 'refunded' },
  ];
  return (
    <div className="wp-demo">
      <div className="wp-loop" aria-hidden="true">
        {stops.map((s, i) => (
          <div className="wp-stop" key={s.key} style={{ ['--i' as string]: String(i) }}>
            <div className="wp-stop-dot" />
            <div className="wp-stop-label">{s.label}</div>
            <div className="wp-stop-sub">{s.sub}</div>
          </div>
        ))}
        <div className="wp-loop-line"><i /></div>
        <span className="wp-traveller" />
      </div>
      <p className="text-sm text-ink-muted mt-4">
        Because the last hop is a refund on the first one, you can always get back what you put in —
        and never more than that.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* All values below are token variables. No literal colours.           */

const CSS = `
.wp-demo { position: relative; }

/* --- 1. split bar --- */
.wp-bar {
  display: flex; height: 12px; border-radius: var(--radius-pill, 999px);
  overflow: hidden; background: var(--color-surface-sunken);
}
.wp-bar-yes, .wp-bar-no { height: 100%; }
.wp-bar-yes { background: var(--color-yes); width: 0; animation: wp-yes 3.4s var(--ease-out, ease-out) infinite; }
.wp-bar-no  { background: var(--color-no);  width: 0; animation: wp-no  3.4s var(--ease-out, ease-out) infinite; }
@keyframes wp-yes { 0% { width: 50%; } 25%,75% { width: 65%; } 100% { width: 50%; } }
@keyframes wp-no  { 0% { width: 50%; } 25%,75% { width: 35%; } 100% { width: 50%; } }

/* --- 2. escrow --- */
.wp-escrow { position: relative; height: 190px; }
.wp-purse {
  position: absolute; top: 8px; display: flex; flex-direction: column; gap: 2px;
  padding: 10px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-card, 12px);
  background: var(--color-surface-elevated); min-width: 92px;
}
.wp-purse-a { left: 0; }
.wp-purse-b { right: 0; }
.wp-purse-label { font-size: 11px; color: var(--color-text-muted); }
.wp-purse-amt { font-size: 15px; color: var(--color-text); }

.wp-vault {
  position: absolute; left: 50%; bottom: 6px; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center;
}
.wp-vault-shackle {
  width: 26px; height: 16px; border: 3px solid var(--color-text-muted);
  border-bottom: none; border-radius: 13px 13px 0 0; margin-bottom: -2px;
  transform-origin: bottom left; animation: wp-lock 4s var(--ease-out, ease-out) infinite;
}
@keyframes wp-lock { 0%,45% { transform: rotate(-32deg) translateX(4px); } 60%,100% { transform: none; } }
.wp-vault-body {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 12px 26px; border-radius: var(--radius-card, 12px);
  background: var(--color-surface-sunken); border: 1px solid var(--color-border-strong);
}
.wp-vault-label { font-size: 11px; color: var(--color-text-muted); letter-spacing: .04em; text-transform: uppercase; }
.wp-vault-amt { font-size: 20px; color: var(--color-text); }

.wp-coin {
  position: absolute; width: 10px; height: 10px; border-radius: 50%;
  background: var(--color-accent); opacity: 0;
}
.wp-coin-1 { left: 42px;  top: 44px; animation: wp-fall-l 4s var(--ease-out, ease-out) infinite; }
.wp-coin-2 { left: 42px;  top: 44px; animation: wp-fall-l 4s var(--ease-out, ease-out) .22s infinite; }
.wp-coin-3 { right: 42px; top: 44px; animation: wp-fall-r 4s var(--ease-out, ease-out) .11s infinite; }
.wp-coin-4 { right: 42px; top: 44px; animation: wp-fall-r 4s var(--ease-out, ease-out) .33s infinite; }
@keyframes wp-fall-l {
  0% { opacity: 0; transform: none; }
  8% { opacity: 1; }
  40% { opacity: 1; transform: translate(calc(50vw - 50vw + 90px), 92px) scale(.85); }
  46%, 100% { opacity: 0; transform: translate(90px, 92px) scale(.6); }
}
@keyframes wp-fall-r {
  0% { opacity: 0; transform: none; }
  8% { opacity: 1; }
  40% { opacity: 1; transform: translate(-90px, 92px) scale(.85); }
  46%, 100% { opacity: 0; transform: translate(-90px, 92px) scale(.6); }
}

/* --- 3. settlement --- */
.wp-settle { display: grid; gap: 18px; }
.wp-pot {
  justify-self: start; display: flex; align-items: baseline; gap: 10px;
  padding: 8px 16px; border-radius: var(--radius-pill, 999px);
  background: var(--color-surface-sunken); border: 1px solid var(--color-border);
  animation: wp-pot-pulse 5s var(--ease-out, ease-out) infinite;
}
@keyframes wp-pot-pulse { 0%,30% { opacity: 1; } 55%,100% { opacity: .45; } }
.wp-pot-label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--color-text-muted); }
.wp-pot-amt { font-size: 17px; color: var(--color-text); }

.wp-winners { display: grid; gap: 14px; }
.wp-winner { display: grid; gap: 5px; opacity: 0; animation: wp-appear 5s var(--ease-out, ease-out) infinite; }
.wp-winner-1 { animation-delay: .45s; }
.wp-winner-2 { animation-delay: .75s; }
.wp-winner-3 { animation-delay: 1.05s; }
@keyframes wp-appear { 0%,6% { opacity: 0; transform: translateY(5px); } 16%,88% { opacity: 1; transform: none; } 100% { opacity: 0; } }
.wp-winner-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.wp-winner-name { font-size: 14px; color: var(--color-text); }
.wp-winner-amt { font-size: 14px; }
.wp-winner-note { font-size: 11px; color: var(--color-text-muted); }
.wp-winner-track { height: 5px; border-radius: 3px; background: var(--color-surface-sunken); overflow: hidden; }
.wp-winner-track i { display: block; height: 100%; width: 0; background: var(--color-win); animation: wp-grow 5s var(--ease-out, ease-out) infinite; }
.wp-winner-1 .wp-winner-track i { animation-delay: .55s; }
.wp-winner-2 .wp-winner-track i { animation-delay: .85s; --w: 45%; }
.wp-winner-track-loss i { background: var(--color-loss); animation-delay: 1.15s; }
@keyframes wp-grow { 0%,10% { width: 0; } 30%,88% { width: var(--w, 62%); } 100% { width: 0; } }

/* --- 4. the loop --- */
.wp-loop { position: relative; display: flex; justify-content: space-between; padding-top: 26px; }
.wp-loop-line { position: absolute; left: 6%; right: 6%; top: 32px; height: 2px; background: var(--color-surface-sunken); border-radius: 2px; }
.wp-loop-line i { display: block; height: 100%; width: 0; background: var(--color-accent); border-radius: 2px; animation: wp-line 6s linear infinite; }
@keyframes wp-line { 0% { width: 0; } 80%,100% { width: 100%; } }
.wp-stop { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; flex: 1; text-align: center; }
.wp-stop-dot {
  width: 13px; height: 13px; border-radius: 50%; background: var(--color-surface);
  border: 2px solid var(--color-border-strong); margin-top: -20px; z-index: 1;
  animation: wp-stop-lit 6s linear infinite; animation-delay: calc(var(--i) * 1.15s);
}
@keyframes wp-stop-lit { 0%,4% { background: var(--color-surface); border-color: var(--color-border-strong); } 10%,100% { background: var(--color-accent); border-color: var(--color-accent); } }
.wp-stop-label { font-size: 12px; color: var(--color-text); margin-top: 6px; }
.wp-stop-sub { font-size: 10.5px; color: var(--color-text-muted); }
.wp-traveller {
  position: absolute; top: 27px; left: 6%; width: 11px; height: 11px; border-radius: 50%;
  background: var(--color-accent); box-shadow: 0 0 0 4px rgb(var(--color-accent-rgb) / .16);
  animation: wp-travel 6s linear infinite;
}
@keyframes wp-travel { 0% { left: 6%; opacity: 0; } 6% { opacity: 1; } 80% { left: 94%; opacity: 1; } 92%,100% { left: 94%; opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .wp-bar-yes { animation: none; width: 65%; }
  .wp-bar-no  { animation: none; width: 35%; }
  .wp-coin, .wp-traveller { display: none; }
  .wp-vault-shackle, .wp-pot, .wp-winner, .wp-stop-dot { animation: none; }
  .wp-winner { opacity: 1; }
  .wp-winner-track i { animation: none; width: 62%; }
  .wp-winner-2 .wp-winner-track i { width: 45%; }
  .wp-loop-line i { animation: none; width: 100%; }
  .wp-stop-dot { background: var(--color-accent); border-color: var(--color-accent); }
}
`;
