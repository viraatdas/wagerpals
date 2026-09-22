/**
 * verify:points-mode — proves the play-money switch actually closes the cash
 * rails, and that nothing in the display layer still says dollars.
 *
 * WHY THIS MATTERS (CLAUDE.md §8): the App Store build stakes points precisely
 * so the app is NOT real money gaming under Guideline 5.3.4, which would demand
 * gambling licensing in every location the app is used. If a deposit or
 * withdrawal could still go through in points mode, or if the UI still rendered
 * "$", that claim would be false and the app would be misrepresented to App
 * Review. This is the regression test for that.
 *
 * No database and no network: it exercises the real `lib/currency-mode`
 * helpers, the real web formatters, and the real mobile formatter logic by
 * toggling the env var the same way production does.
 *
 *   npx tsx scripts/verify-points-mode.ts
 */

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function withMode<T>(mode: string | undefined, fn: () => T): T {
  const prev = process.env.WAGER_CURRENCY_MODE;
  if (mode === undefined) delete process.env.WAGER_CURRENCY_MODE;
  else process.env.WAGER_CURRENCY_MODE = mode;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.WAGER_CURRENCY_MODE;
    else process.env.WAGER_CURRENCY_MODE = prev;
  }
}

async function main() {
  console.log('\nverify:points-mode\n');

  const { currencyMode, isPointsMode, CASH_RAILS_CLOSED } = await import('../lib/currency-mode');

  console.log('mode resolution');
  check('defaults to usd when unset', withMode(undefined, () => currencyMode()) === 'usd');
  check('usd when set to usd', withMode('usd', () => currencyMode()) === 'usd');
  check('points when set to points', withMode('points', () => currencyMode()) === 'points');
  check(
    'an unrecognised value falls back to usd, never points',
    withMode('POINTS', () => currencyMode()) === 'usd' &&
      withMode('yes', () => currencyMode()) === 'usd',
    'only the exact string "points" may switch real money off, so a typo cannot silently close the rails'
  );
  check('isPointsMode agrees with currencyMode', withMode('points', () => isPointsMode()) === true);
  check('CASH_RAILS_CLOSED carries a machine-readable code', CASH_RAILS_CLOSED.code === 'CASH_RAILS_CLOSED');
  check(
    'CASH_RAILS_CLOSED explains points and never points at a card or refund',
    /point/i.test(CASH_RAILS_CLOSED.error) && !/card|refund|bank/i.test(CASH_RAILS_CLOSED.error),
    CASH_RAILS_CLOSED.error
  );

  console.log('\nweb formatters (lib/utils.formatAmount)');
  const { formatAmount } = await import('../lib/utils');
  check('usd mode still renders dollars', withMode('usd', () => formatAmount(12.5)) === '+$12.50');
  const pts = withMode('points', () => formatAmount(12.5));
  check('points mode renders points', /pts?$/.test(pts), pts);
  check('points mode renders no currency symbol', !pts.includes('$'), pts);
  const negPts = withMode('points', () => formatAmount(-3));
  check('negative points keep their sign', negPts.startsWith('-') && !negPts.includes('$'), negPts);
  const onePt = withMode('points', () => formatAmount(1));
  check('a single point is singular', onePt === '+1 pt', onePt);

  console.log('\nbackend copy (lib/payments.formatCurrencyAmount)');
  const { formatCurrencyAmount } = await import('../lib/payments');
  check('usd mode still renders dollars', withMode('usd', () => formatCurrencyAmount(25)) === '$25.00');
  const pc = withMode('points', () => formatCurrencyAmount(25));
  check('points mode renders points with no symbol', pc === '25 pts', pc);

  console.log('\nthe route gate is reachable before any I/O');
  // The gate lives in app/api/wallet/route.ts ahead of ensureWallet() and
  // getStripe(). Assert that ordering statically — a refactor that moves it
  // below either one would let a points-mode deployment write rows or build a
  // Stripe client on a cash request.
  const fs = await import('fs');
  const route = fs.readFileSync('app/api/wallet/route.ts', 'utf8');
  const gateAt = route.indexOf('isPointsMode() && (action ===');
  const ensureAt = route.indexOf('await ensureWallet(user_id)');
  // getStripe() is also called by the refund gateway helper near the top of the
  // file, so anchor on the call inside the POST deposit branch specifically.
  const postAt = route.indexOf('export async function POST');
  const stripeAt = route.indexOf('const stripe = getStripe()', postAt);
  check('the points gate exists in the wallet route', gateAt > -1);
  check('the gate runs before ensureWallet', gateAt > -1 && ensureAt > -1 && gateAt < ensureAt);
  check(
    'the gate runs before Stripe is constructed in the deposit branch',
    gateAt > -1 && stripeAt > -1 && postAt > -1 && gateAt < stripeAt
  );
  check(
    'the gate covers withdraw as well as deposit',
    /isPointsMode\(\) && \(action === 'deposit' \|\| action === 'withdraw'\)/.test(route)
  );
  check('GET advertises currency_mode to clients', /currency_mode: currencyMode\(\)/.test(route));
  check('GET zeroes the withdrawable ceiling in points mode', /withdrawable: isPointsMode\(\) \? 0 :/.test(route));

  console.log('\nmobile display layer');
  const mobileCurrency = fs.readFileSync('mobile/src/utils/currency.ts', 'utf8');
  check(
    'mobile defaults to points, so a missing env var cannot ship dollars',
    /EXPO_PUBLIC_CURRENCY_MODE === 'usd' \? 'usd' : 'points'/.test(mobileCurrency)
  );
  const mobileFormat = fs.readFileSync('mobile/src/utils/format.ts', 'utf8');
  check('mobile formatMoney branches on IS_POINTS', /IS_POINTS/.test(mobileFormat));
  // Money.tsx renders the biggest numbers in the app (the wallet balance hero
  // among them) and used to carry its OWN hardcoded "$" formatter that bypassed
  // formatMoney entirely — a points build would have shown dollar signs on the
  // headline figure. Guard that it stays mode-aware.
  const money = fs.readFileSync('mobile/src/components/Money.tsx', 'utf8');
  check('the Money component respects the currency mode', /IS_POINTS/.test(money));
  check(
    'the Money component has no unconditional dollar formatter left',
    !/^\s*return `\$\{sign\}\$\$\{abs\}`;/m.test(money)
  );

  const wallet = fs.readFileSync('mobile/src/screens/WalletScreen.tsx', 'utf8');
  check('the mobile wallet hides the cash rails in points mode', /IS_POINTS \? null : \(/.test(wallet));
  check(
    'the mobile wallet has no unconditional "Add funds" button left',
    !/^\s*title="Add funds"/m.test(wallet.replace(/\{IS_POINTS \? null : \([\s\S]*?\n      \)\}/m, ''))
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
