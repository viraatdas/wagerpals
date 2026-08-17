// Proof that the ledger's escrow chips describe EVERY player's stake, not just
// the signed-in viewer's own bets.
//
// The bug: Ledger.tsx built its per-bet escrow map from GET /api/wallet, whose
// payload is scoped to one user (lib/payments.ts getWalletSummary selects
// `WHERE user_id = $me`). In a cash event with several players, the viewer saw
// an "Escrowed" chip on their own bet and nothing on anyone else's — reading as
// if the other players had no money at stake.
//
// The fix: GET /api/events?id= now returns `escrow_by_bet` (bet id -> escrow
// status, for every bet), and the ledger renders chips off that.
//
// This script drives the REAL route handler and the REAL money engine
// (lib/payments.ts) against the shared Neon dev database, then server-renders
// the REAL Ledger component with the payload the page would hand it.
//
// SAFETY: every row it writes is tagged with a unique run prefix (`RUN`), and
// cleanup deletes only rows carrying that prefix. Nothing pre-existing is
// touched, and it never resolves or reads anyone else's event.
//
// Run:   npx tsx scripts/verify-escrow-chips.ts
// Debug: npx tsx scripts/verify-escrow-chips.ts --keep   (skips cleanup)

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { readFileSync } from 'fs';
import { resolve as pathResolve } from 'path';
import { NextRequest } from 'next/server';
import { sql } from '@vercel/postgres';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { db } from '../lib/db';
import { placeCashBet, settleCashEvent, getWalletSummary } from '../lib/payments';
import * as eventsRoute from '../app/api/events/route';
import type { Bet, EscrowHoldStatus } from '../lib/types';

// The repo's tsconfig uses jsx:"preserve" (Next compiles JSX itself), so tsx
// falls back to the classic runtime and the component modules reference a bare
// `React`. Provide it, then import the component lazily so the global is set
// before the module body runs.
(globalThis as any).React = React;

const KEEP = process.argv.includes('--keep');
const RUN = `vec_${Date.now().toString(36)}`;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let totalChecks = 0;
let failedChecks = 0;
const failureMessages: string[] = [];

function assert(condition: boolean, message: string): void {
  totalChecks++;
  if (condition) {
    console.log(`    ✅ ${message}`);
  } else {
    failedChecks++;
    console.log(`    ❌ ${message}`);
    failureMessages.push(message);
  }
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n▶ ${name}`);
  const before = failedChecks;
  try {
    await fn();
  } catch (err: any) {
    failedChecks++;
    totalChecks++;
    const msg = `${name} — unexpected exception: ${err?.message || err}`;
    console.log(`    ❌ ${msg}`);
    if (err?.stack) console.log(String(err.stack).split('\n').slice(0, 5).join('\n'));
    failureMessages.push(msg);
  }
  console.log(failedChecks === before ? `  ✅ ${name}` : `  ❌ ${name}`);
}

/** GET /api/events?id= is a public read — no auth headers needed or accepted. */
async function getEvent(eventId: string): Promise<{ status: number; body: any }> {
  const req = new NextRequest(`http://localhost:3000/api/events?id=${eventId}`, { method: 'GET' });
  const res = await eventsRoute.GET(req);
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// Rendering the real component
// ---------------------------------------------------------------------------

type LedgerRenderProps = {
  bets: Bet[];
  currentUserId?: string;
  paymentType?: 'none' | 'cash';
  escrowByBet?: Record<string, EscrowHoldStatus>;
};

let Ledger: any = null;

async function renderLedger(props: LedgerRenderProps): Promise<string> {
  if (!Ledger) Ledger = (await import('../components/Ledger')).default;
  // eventId is deliberately omitted: it only gates the wallet panel, whose
  // <Link> needs an app-router context this standalone renderer has none of.
  // The escrow chips do not depend on it.
  return renderToStaticMarkup(React.createElement(Ledger, props as any));
}

function countChips(html: string, label: string): number {
  return (html.match(new RegExp(`>${label}</span>`, 'g')) || []).length;
}

/** renderToStaticMarkup escapes apostrophes, so match either form. */
function mentionsStakeOf(html: string, username: string, verbPhrase: string): boolean {
  return new RegExp(`@${username}(&#x27;|')s stake ${verbPhrase}`).test(html);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const aliceId = `${RUN}_alice`;
const bobId = `${RUN}_bob`;
const carolId = `${RUN}_carol`;
const testUserIds = [aliceId, bobId, carolId];
const usernames: Record<string, string> = {
  [aliceId]: `${RUN}alice`,
  [bobId]: `${RUN}bob`,
  [carolId]: `${RUN}carol`,
};
const groupId = `${RUN}_grp`;
const resolveEventId = `${RUN}_ev_resolve`;
const cancelEventId = `${RUN}_ev_cancel`;
const freeEventId = `${RUN}_ev_free`;

async function createCashEvent(id: string, title: string): Promise<void> {
  await db.events.create({
    id,
    title,
    side_a: 'yes',
    side_b: 'no',
    end_time: Date.now() + 60 * 60 * 1000,
    group_id: groupId,
    status: 'active',
    payment_type: 'cash',
    stake_amount: null,
  });
}

async function main(): Promise<void> {
  console.log(`\n=== verify-escrow-chips (run ${RUN}) ===`);

  let bobBet!: Bet;
  let carolBet!: Bet;
  let cancelBobBet!: Bet;
  let cancelCarolBet!: Bet;

  try {
    await step('Setup: users, group, funded wallets, two cash events', async () => {
      for (const uid of testUserIds) {
        await sql`
          INSERT INTO users (id, username, net_total, total_bet, streak)
          VALUES (${uid}, ${usernames[uid]}, 0, 0, 0)
        `;
      }
      await sql`
        INSERT INTO groups (id, name, created_by, resolver_user_id, is_public)
        VALUES (${groupId}, ${`Verify Escrow Chips ${RUN}`}, ${aliceId}, ${aliceId}, false)
      `;
      for (const [uid, role] of [[aliceId, 'admin'], [bobId, 'member'], [carolId, 'member']] as const) {
        await sql`INSERT INTO group_members (group_id, user_id, role, status) VALUES (${groupId}, ${uid}, ${role}, 'active')`;
      }
      for (const uid of [bobId, carolId]) {
        await db.wallets.getOrCreate(uid);
        await db.wallets.updateBalance(uid, 100);
      }

      await createCashEvent(resolveEventId, `Escrow chips (resolve) ${RUN}`);
      await createCashEvent(cancelEventId, `Escrow chips (cancel) ${RUN}`);
      await db.events.create({
        id: freeEventId,
        title: `Escrow chips (free) ${RUN}`,
        side_a: 'yes',
        side_b: 'no',
        end_time: Date.now() + 60 * 60 * 1000,
        group_id: groupId,
        status: 'active',
        payment_type: 'none',
      });

      const u = await sql`SELECT COUNT(*)::int AS n FROM users WHERE id = ANY(${testUserIds as any}::text[])`;
      assert(u.rows[0].n === 3, 'all 3 test users inserted');
      assert((await db.wallets.get(bobId))?.balance === 100, 'bob funded $100');
      assert((await db.wallets.get(carolId))?.balance === 100, 'carol funded $100');
    });

    await step('Two players stake real money on the same event', async () => {
      bobBet = (await placeCashBet({ eventId: resolveEventId, userId: bobId, username: usernames[bobId], side: 'yes', amount: 10 })).bet;
      carolBet = (await placeCashBet({ eventId: resolveEventId, userId: carolId, username: usernames[carolId], side: 'no', amount: 15 })).bet;
      assert(bobBet.id !== carolBet.id, 'two distinct bets placed by two distinct users');
      const holds = await sql`SELECT COUNT(*)::int AS n FROM escrow_holds WHERE event_id = ${resolveEventId} AND status = 'held'`;
      assert(holds.rows[0].n === 2, 'both stakes are held in escrow');
    });

    // -----------------------------------------------------------------
    // The bug, stated as a check: the viewer-scoped source only ever
    // covers one player, which is why the chips needed a new source.
    // -----------------------------------------------------------------
    await step('GET /api/wallet is viewer-scoped (the old chip source, one player only)', async () => {
      const bobSummary = await getWalletSummary(bobId, resolveEventId);
      const carolSummary = await getWalletSummary(carolId, resolveEventId);
      assert(bobSummary.event?.holds.length === 1, "bob's wallet summary carries only bob's hold");
      assert(bobSummary.event?.holds[0]?.bet_id === bobBet.id, "bob's only hold is against bob's bet");
      assert(carolSummary.event?.holds.length === 1, "carol's wallet summary carries only carol's hold");
      assert(carolSummary.event?.holds[0]?.bet_id === carolBet.id, "carol's only hold is against carol's bet");
    });

    await step('GET /api/events?id= returns escrow status for EVERY bet', async () => {
      const { status, body } = await getEvent(resolveEventId);
      assert(status === 200, `event GET returns 200 (got ${status})`);
      const map: Record<string, EscrowHoldStatus> = body.escrow_by_bet;
      assert(!!map && typeof map === 'object', 'response carries escrow_by_bet');
      assert(Object.keys(map).length === 2, `escrow_by_bet covers both bets (got ${Object.keys(map || {}).length})`);
      assert(map?.[bobBet.id] === 'held', "bob's bet is 'held' in escrow_by_bet");
      assert(map?.[carolBet.id] === 'held', "carol's bet is 'held' in escrow_by_bet");
      assert(body.escrow_total === 25, `escrow_total is the whole pot, $25 (got ${body.escrow_total})`);

      // Viewer-independence: the payload is a public read with no per-user
      // branch, so two separate calls must agree byte for byte.
      const second = await getEvent(resolveEventId);
      assert(
        JSON.stringify(second.body.escrow_by_bet) === JSON.stringify(map),
        'escrow_by_bet does not vary between callers'
      );
    });

    await step('Free events carry no escrow state', async () => {
      const { body } = await getEvent(freeEventId);
      assert(
        body.escrow_by_bet && Object.keys(body.escrow_by_bet).length === 0,
        'a payment_type=none event returns an empty escrow_by_bet'
      );
    });

    await step('Ledger renders an escrow chip on every player\'s bet', async () => {
      const { body } = await getEvent(resolveEventId);
      const bets: Bet[] = body.bets;
      const escrowByBet: Record<string, EscrowHoldStatus> = body.escrow_by_bet;

      const asBob = await renderLedger({ bets, currentUserId: bobId, paymentType: 'cash', escrowByBet });
      assert(countChips(asBob, 'Escrowed') === 2, `bob sees 2 Escrowed chips (got ${countChips(asBob, 'Escrowed')})`);
      assert(/Your stake is held/.test(asBob), "bob's own chip reads 'Your stake is held'");
      assert(mentionsStakeOf(asBob, usernames[carolId], 'is held'), "bob sees carol's chip named as carol's stake");

      const asCarol = await renderLedger({ bets, currentUserId: carolId, paymentType: 'cash', escrowByBet });
      assert(countChips(asCarol, 'Escrowed') === 2, `carol sees 2 Escrowed chips (got ${countChips(asCarol, 'Escrowed')})`);
      assert(/Your stake is held/.test(asCarol), "carol's own chip reads 'Your stake is held'");
      assert(mentionsStakeOf(asCarol, usernames[bobId], 'is held'), "carol sees bob's chip named as bob's stake");

      const asStranger = await renderLedger({ bets, paymentType: 'cash', escrowByBet });
      assert(countChips(asStranger, 'Escrowed') === 2, 'a viewer with no bets still sees both chips');
      assert(!/Your stake/.test(asStranger), "a viewer with no bets is never told a stake is 'yours'");
      assert(
        mentionsStakeOf(asStranger, usernames[bobId], 'is held') && mentionsStakeOf(asStranger, usernames[carolId], 'is held'),
        'both chips name their owner for a viewer with no bets'
      );

      // Control: without the event-wide map there are no chips at all, so the
      // counts above are not passing for some unrelated reason.
      const withoutMap = await renderLedger({ bets, currentUserId: bobId, paymentType: 'cash' });
      assert(countChips(withoutMap, 'Escrowed') === 0, 'no escrow_by_bet -> no chips (control)');
    });

    await step('Resolving the event flips every chip to Settled', async () => {
      const settlement = await settleCashEvent(resolveEventId, 'yes');
      assert(settlement.mode === 'payout', `settlement paid out (mode=${settlement.mode})`);
      await db.events.update(resolveEventId, { status: 'resolved' });

      const { body } = await getEvent(resolveEventId);
      const map: Record<string, EscrowHoldStatus> = body.escrow_by_bet;
      assert(map?.[bobBet.id] === 'released', "the winner's bet reads 'released'");
      assert(map?.[carolBet.id] === 'released', "the loser's bet reads 'released' too");
      assert(body.escrow_total === 0, 'nothing is left held after settlement');

      const html = await renderLedger({ bets: body.bets, currentUserId: bobId, paymentType: 'cash', escrowByBet: map });
      assert(countChips(html, 'Settled') === 2, `both bets show a Settled chip (got ${countChips(html, 'Settled')})`);
      assert(mentionsStakeOf(html, usernames[carolId], 'left escrow'), "the other player's Settled chip names them");
    });

    // The iPhone app renders the same chip off the same payload. React Native
    // components can't be server-rendered here, so this step proves the two
    // halves that actually matter: (1) live, that `bets[].escrow_hold_id` — the
    // column the mobile screen used to gate on — is STILL set on a settled
    // event, so that gate is provably stale; and (2) statically, that the
    // screen now reads `escrow_by_bet` and that its chip labels match the web's.
    await step('The iPhone app reads the same per-bet escrow status as the web', async () => {
      const { body } = await getEvent(resolveEventId);
      const map: Record<string, EscrowHoldStatus> = body.escrow_by_bet;
      const bets: Bet[] = body.bets;

      // (1) The stale-gate proof.
      assert(
        bets.length === 2 && bets.every((b) => !!b.escrow_hold_id),
        'every settled bet STILL carries escrow_hold_id (so it cannot mean "currently escrowed")',
      );
      assert(
        bets.every((b) => map?.[b.id] === 'released'),
        'yet escrow_by_bet reports all of them as released — the two disagree, and escrow_by_bet is right',
      );

      // (2) The mobile source must consume the right one.
      const screen = readFileSync(pathResolve(process.cwd(), 'mobile/src/screens/EventDetailScreen.tsx'), 'utf8');
      const types = readFileSync(pathResolve(process.cwd(), 'mobile/src/types/index.ts'), 'utf8');

      assert(
        !/bet\.escrow_hold_id\s*\?/.test(screen),
        'EventDetailScreen no longer gates its escrow chip on bet.escrow_hold_id',
      );
      assert(
        screen.includes('event.escrow_by_bet?.[bet.id]'),
        'EventDetailScreen feeds each BetRow the escrow status from event.escrow_by_bet',
      );
      assert(
        /escrow_by_bet\?:\s*Record<string,\s*EscrowHoldStatus>/.test(types),
        'mobile EventWithStats declares escrow_by_bet, so the field survives the API boundary',
      );

      // (3) Web and mobile must agree on what each status is called. Read both
      // chip tables out of source rather than restating the labels here, so a
      // future rename on one side fails this check instead of drifting.
      const ledger = readFileSync(pathResolve(process.cwd(), 'components/Ledger.tsx'), 'utf8');
      const labelsFrom = (src: string, table: string): string[] => {
        const block = src.slice(src.indexOf(table));
        const body = block.slice(block.indexOf('{'), block.indexOf('};'));
        return (['held', 'released', 'refunded'] as const).map((status) => {
          const m = new RegExp(`${status}:\\s*\\{[^}]*label:\\s*'([^']+)'`).exec(body);
          return m ? m[1] : `<missing:${status}>`;
        });
      };
      const webLabels = labelsFrom(ledger, 'HOLD_CHIPS');
      const mobileLabels = labelsFrom(screen, 'HOLD_PILLS');
      assert(
        webLabels.join('|') === 'Escrowed|Settled|Refunded',
        `the web chip labels are the expected three (got ${webLabels.join(', ')})`,
      );
      assert(
        mobileLabels.join('|') === webLabels.join('|'),
        `mobile chip labels match the web's (web: ${webLabels.join(', ')} / mobile: ${mobileLabels.join(', ')})`,
      );
      assert(
        /isOwnBet\s*\?\s*'your stake'/.test(screen),
        "mobile's chip label names whose stake it is, exactly as the web tooltip does",
      );
    });

    await step('Cancelling an event flips every chip to Refunded', async () => {
      cancelBobBet = (await placeCashBet({ eventId: cancelEventId, userId: bobId, username: usernames[bobId], side: 'yes', amount: 5 })).bet;
      cancelCarolBet = (await placeCashBet({ eventId: cancelEventId, userId: carolId, username: usernames[carolId], side: 'no', amount: 7 })).bet;

      const settlement = await settleCashEvent(cancelEventId, null);
      assert(settlement.mode === 'refund', `cancellation refunded (mode=${settlement.mode})`);
      await db.events.update(cancelEventId, { status: 'resolved' });

      const { body } = await getEvent(cancelEventId);
      const map: Record<string, EscrowHoldStatus> = body.escrow_by_bet;
      assert(map?.[cancelBobBet.id] === 'refunded', "bob's cancelled bet reads 'refunded'");
      assert(map?.[cancelCarolBet.id] === 'refunded', "carol's cancelled bet reads 'refunded'");

      const html = await renderLedger({ bets: body.bets, currentUserId: carolId, paymentType: 'cash', escrowByBet: map });
      assert(countChips(html, 'Refunded') === 2, `both bets show a Refunded chip (got ${countChips(html, 'Refunded')})`);
      assert(/and your stake was returned/.test(html), "carol's own chip reads 'your stake was returned'");
      assert(mentionsStakeOf(html, usernames[bobId], 'was returned'), "bob's chip is named as bob's stake");
    });
  } finally {
    if (KEEP) {
      console.log(`\n  --keep passed: skipping cleanup. Rows tagged ${RUN} are still in the database.`);
    } else {
      console.log('\n▶ Cleanup');
      const eventIds = [resolveEventId, cancelEventId, freeEventId];
      try {
        await sql`DELETE FROM transactions WHERE user_id = ANY(${testUserIds as any}::text[])`;
        await sql`DELETE FROM escrow_holds WHERE event_id = ANY(${eventIds as any}::text[])`;
        await sql`DELETE FROM bets WHERE event_id = ANY(${eventIds as any}::text[])`;
        await sql`DELETE FROM activities WHERE event_id = ANY(${eventIds as any}::text[])`;
        await sql`DELETE FROM events WHERE id = ANY(${eventIds as any}::text[])`;
        await sql`DELETE FROM group_members WHERE group_id = ${groupId}`;
        await sql`DELETE FROM groups WHERE id = ${groupId}`;
        await sql`DELETE FROM wallets WHERE user_id = ANY(${testUserIds as any}::text[])`;
        await sql`DELETE FROM users WHERE id = ANY(${testUserIds as any}::text[])`;
        const leftover = await sql`SELECT COUNT(*)::int AS n FROM users WHERE id = ANY(${testUserIds as any}::text[])`;
        console.log(leftover.rows[0].n === 0 ? '    ✅ all test rows removed' : `    ⚠️  ${leftover.rows[0].n} test user(s) left behind`);
      } catch (err: any) {
        console.log(`    ⚠️  cleanup error — ${err?.message || err}`);
      }
    }
  }

  console.log(`\n=== ${totalChecks - failedChecks}/${totalChecks} checks passed ===`);
  if (failedChecks > 0) {
    console.log('\nFailures:');
    for (const m of failureMessages) console.log(`  - ${m}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
