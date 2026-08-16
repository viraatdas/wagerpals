// Proof-of-correctness for lib/comments.ts, the isomorphic comment-thread
// helper module shared by app/api/comments/route.ts and the client
// components (CommentForm, CommentThread).
//
// This touches NEITHER a database NOR the network — lib/comments.ts is pure
// TypeScript with no I/O, so every check here is a plain function call
// against in-memory fixtures. Mirrors the numbered-check / pass-fail-counter
// house style of scripts/verify-notifications.ts and scripts/verify-payments.ts.
//
// Run: npx tsx scripts/verify-comments.ts

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MAX_COMMENT_LENGTH,
  MAX_COMMENT_DEPTH,
  ALLOWED_REACTION_EMOJI,
  isAllowedReaction,
  validateCommentContent,
  parseMentionUsernames,
  segmentCommentContent,
  commentDepth,
  resolveParentId,
  buildCommentTree,
  countReplies,
  checkCommentRateLimit,
  resetCommentRateLimit,
  formatRelativeTime,
} from '../lib/comments';

// ---------------------------------------------------------------------------
// Harness (mirrors scripts/verify-notifications.ts house style)
// ---------------------------------------------------------------------------

let checksTotal = 0;
let checksFailed = 0;
const failureSummaries: string[] = [];

function runCheck(n: number, title: string, fn: (assert: (cond: boolean, msg: string) => void) => void): void {
  checksTotal++;
  const failures: string[] = [];
  const assertFn = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };
  try {
    fn(assertFn);
  } catch (err: any) {
    failures.push(`threw unexpectedly: ${err?.message || err}`);
    if (err?.stack) failures.push(String(err.stack).split('\n').slice(1, 4).join(' | '));
  }
  if (failures.length === 0) {
    console.log(`✅ Check ${n}: ${title}`);
  } else {
    checksFailed++;
    console.log(`❌ Check ${n}: ${title}`);
    for (const f of failures) console.log(`     - ${f}`);
    failureSummaries.push(`Check ${n} (${title}): ${failures.join('; ')}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface FixtureComment {
  id: string;
  parent_id?: string | null;
  timestamp: number;
}

function parentMapFrom(entries: Array<[string, string | null | undefined]>): Map<string, string | null | undefined> {
  return new Map(entries);
}

function main(): void {
  console.log('='.repeat(78));
  console.log('  verify-comments — pure in-memory checks of lib/comments.ts (no DB, no network)');
  console.log('='.repeat(78));

  // -------------------------------------------------------------------
  // Check 1 — validateCommentContent
  // -------------------------------------------------------------------
  runCheck(1, 'validateCommentContent: reject/accept/trim/collapse rules', (assert) => {
    assert(validateCommentContent(123).valid === false, 'non-string rejected');
    assert(validateCommentContent(123).error === 'Comment must be text', 'non-string error message');

    assert(validateCommentContent('').valid === false, 'empty string rejected');
    assert(validateCommentContent('   \n\t  ').valid === false, 'whitespace-only rejected');
    assert(validateCommentContent('   \n\t  ').error === 'Comment cannot be empty', 'whitespace-only error message');

    const tooLong = 'a'.repeat(MAX_COMMENT_LENGTH + 1);
    const tooLongResult = validateCommentContent(tooLong);
    assert(tooLongResult.valid === false, `${MAX_COMMENT_LENGTH + 1}-char comment rejected`);
    assert(tooLongResult.error === `Comment is too long (max ${MAX_COMMENT_LENGTH} characters)`, 'too-long error message');

    const exactLength = 'b'.repeat(MAX_COMMENT_LENGTH);
    const exactResult = validateCommentContent(exactLength);
    assert(exactResult.valid === true, `exactly ${MAX_COMMENT_LENGTH}-char comment accepted`);
    assert(exactResult.value === exactLength, 'exact-length value preserved');

    const trimmed = validateCommentContent('   hello world   ');
    assert(trimmed.valid === true, 'padded comment accepted');
    assert(trimmed.value === 'hello world', 'leading/trailing whitespace trimmed');

    const collapsed = validateCommentContent('line1\n\n\n\nline2');
    assert(collapsed.valid === true, 'multi-blank-line comment accepted');
    assert(collapsed.value === 'line1\n\nline2', '4 consecutive newlines collapsed to exactly 2');

    const crlf = validateCommentContent('a\r\nb\rc');
    assert(crlf.valid === true, 'CRLF/CR input accepted');
    assert(crlf.value === 'a\nb\nc', '\\r\\n and \\r both normalised to \\n');
  });

  // -------------------------------------------------------------------
  // Check 2 — parseMentionUsernames
  // -------------------------------------------------------------------
  runCheck(2, 'parseMentionUsernames: extraction, email exclusion, length bounds, dedupe, cap', (assert) => {
    const basic = parseMentionUsernames('hi @alice and @Bob!');
    assert(JSON.stringify(basic) === JSON.stringify(['alice', 'bob']), `basic + case-fold + dedupe order (got ${JSON.stringify(basic)})`);

    const email = parseMentionUsernames('mail me at bob@example.com');
    assert(email.length === 0, `no mention parsed inside an email address (got ${JSON.stringify(email)})`);

    const oneChar = parseMentionUsernames('@a');
    assert(oneChar.length === 0, `single-character handle (below the 2-char minimum) is not a mention (got ${JSON.stringify(oneChar)})`);

    const dup = parseMentionUsernames('@carol said hi to @Carol and @CAROL');
    assert(JSON.stringify(dup) === JSON.stringify(['carol']), `duplicates (case-insensitive) deduped (got ${JSON.stringify(dup)})`);

    const paren = parseMentionUsernames('(@carol)');
    assert(JSON.stringify(paren) === JSON.stringify(['carol']), `mention inside parens matches (got ${JSON.stringify(paren)})`);

    const many = Array.from({ length: 30 }, (_, i) => `@user${i}`).join(' ');
    const cappedResult = parseMentionUsernames(many);
    assert(cappedResult.length === 20, `30 distinct mentions capped at 20 (got ${cappedResult.length})`);
    assert(cappedResult[0] === 'user0' && cappedResult[19] === 'user19', 'cap keeps the first 20 in appearance order');
  });

  // -------------------------------------------------------------------
  // Check 3 — segmentCommentContent
  // -------------------------------------------------------------------
  runCheck(3, 'segmentCommentContent: round-trips, resolve(), and never emits raw markup', (assert) => {
    const roundTripInputs = [
      'no mentions here at all',
      '@alice leads with a mention',
      'trailing mention @bob',
      'multiple @alice and @bob and @carol in one line',
      '',
      'weird spacing   @alice   between words',
      'punctuation: (@alice), "@bob", and @carol!',
    ];
    for (const input of roundTripInputs) {
      const segs = segmentCommentContent(input);
      const rebuilt = segs.map((s) => s.value).join('');
      assert(rebuilt === input, `round-trip for ${JSON.stringify(input)} (got ${JSON.stringify(rebuilt)})`);
      assert(
        segs.every((s) => s.type === 'text' || s.type === 'mention'),
        `every segment for ${JSON.stringify(input)} is type 'text' or 'mention'`
      );
    }

    const resolver = (usernameLower: string) => (usernameLower === 'alice' ? 'user-alice-id' : undefined);
    const resolved = segmentCommentContent('hi @alice and @bob', resolver);
    const aliceSeg = resolved.find((s) => s.type === 'mention' && s.value === '@alice');
    const bobSeg = resolved.find((s) => s.type === 'mention' && s.value === '@bob');
    assert(aliceSeg?.userId === 'user-alice-id', `resolvable mention gets userId (got ${JSON.stringify(aliceSeg)})`);
    assert(bobSeg !== undefined && bobSeg.userId === undefined, `unresolvable mention has no userId (got ${JSON.stringify(bobSeg)})`);

    const noResolve = segmentCommentContent('hi @alice');
    const noResolveSeg = noResolve.find((s) => s.type === 'mention');
    assert(noResolveSeg?.userId === undefined, 'omitted resolve() leaves userId unset but still type mention');

    // XSS-shaped input: the renderer must receive plain segment VALUES, never
    // markup to inject. Assert the dangerous string survives byte-for-byte
    // inside segment values (proof it was never parsed/executed as HTML) and
    // that every segment is still a plain text/mention segment.
    const xss = '<img src=x onerror=alert(1)> @alice';
    const xssSegs = segmentCommentContent(xss);
    const xssRebuilt = xssSegs.map((s) => s.value).join('');
    assert(xssRebuilt === xss, `XSS-shaped input round-trips untouched (got ${JSON.stringify(xssRebuilt)})`);
    assert(
      xssSegs.every((s) => s.type === 'text' || s.type === 'mention'),
      'XSS-shaped input: every segment is type text/mention (no html/script/other kind)'
    );
    const xssMention = xssSegs.find((s) => s.type === 'mention');
    assert(xssMention?.value === '@alice', `XSS-shaped input: the mention segment is exactly '@alice' (got ${JSON.stringify(xssMention)})`);
    const xssTextJoined = xssSegs
      .filter((s) => s.type === 'text')
      .map((s) => s.value)
      .join('');
    assert(xssTextJoined.includes('<img src=x onerror=alert(1)>'), 'the raw tag text is preserved verbatim inside a text segment value, not executed as markup');
  });

  // -------------------------------------------------------------------
  // Check 4 — commentDepth / resolveParentId
  // -------------------------------------------------------------------
  runCheck(4, 'commentDepth / resolveParentId: depth cap, unknown parent, cycle termination', (assert) => {
    // 5-deep chain: c0 (root) -> c1 -> c2 -> c3 -> c4
    const chain = parentMapFrom([
      ['c0', null],
      ['c1', 'c0'],
      ['c2', 'c1'],
      ['c3', 'c2'],
      ['c4', 'c3'],
    ]);
    assert(commentDepth('c0', chain) === 0, 'c0 (root) has depth 0');
    assert(commentDepth('c1', chain) === 1, 'c1 has depth 1');
    assert(commentDepth('c4', chain) === 4, 'c4 has depth 4');

    // A reply targeting the deepest node (c4) must flatten onto an ancestor
    // shallow enough that the NEW child lands at depth <= MAX_COMMENT_DEPTH-1.
    const resolved = resolveParentId('c4', chain);
    assert(resolved !== null, 'resolveParentId against a 5-deep chain returns a real ancestor, not null');
    const newChildDepth = (commentDepth(resolved as string, chain) + 1);
    assert(newChildDepth <= MAX_COMMENT_DEPTH - 1, `a reply attached to the resolved ancestor lands at depth <= ${MAX_COMMENT_DEPTH - 1} (got ${newChildDepth})`);

    // Unknown parent id -> null.
    assert(resolveParentId('does-not-exist', chain) === null, 'unknown requested parent id resolves to null');
    assert(resolveParentId(null, chain) === null, 'falsy (null) requested parent id resolves to null');
    assert(resolveParentId(undefined, chain) === null, 'falsy (undefined) requested parent id resolves to null');

    // Cyclic map: a -> b -> a. Must terminate (not hang) for both helpers.
    const cyclic = parentMapFrom([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    const cyclicDepth = commentDepth('a', cyclic);
    assert(Number.isFinite(cyclicDepth) && cyclicDepth <= 32, `commentDepth terminates on a cyclic map (got ${cyclicDepth})`);
    const cyclicResolve = resolveParentId('a', cyclic);
    assert(cyclicResolve === 'a' || cyclicResolve === 'b', `resolveParentId terminates on a cyclic map and returns a map member (got ${cyclicResolve})`);
  });

  // -------------------------------------------------------------------
  // Check 5 — buildCommentTree
  // -------------------------------------------------------------------
  runCheck(5, 'buildCommentTree: orphans become roots, timestamp ordering, exactly-once, cycle termination', (assert) => {
    const comments: FixtureComment[] = [
      { id: 'root-b', parent_id: null, timestamp: 200 },
      { id: 'root-a', parent_id: null, timestamp: 100 },
      { id: 'orphan', parent_id: 'missing-parent', timestamp: 150 }, // parent not in set -> becomes a root
      { id: 'child-a2', parent_id: 'root-a', timestamp: 120 },
      { id: 'child-a1', parent_id: 'root-a', timestamp: 110 },
      { id: 'grandchild', parent_id: 'child-a1', timestamp: 115 },
    ];
    const tree = buildCommentTree(comments);

    assert(tree.length === 3, `3 roots expected: root-a, root-b, orphan (got ${tree.length})`);
    const rootIds = tree.map((n) => n.comment.id);
    assert(rootIds.includes('orphan'), 'the comment with a missing parent surfaces as a root');

    // Roots sorted by timestamp ASC then id ASC: root-a(100), orphan(150), root-b(200).
    assert(JSON.stringify(rootIds) === JSON.stringify(['root-a', 'orphan', 'root-b']), `roots ordered by timestamp ASC (got ${JSON.stringify(rootIds)})`);

    const rootA = tree.find((n) => n.comment.id === 'root-a')!;
    const childIds = rootA.children.map((c) => c.comment.id);
    assert(JSON.stringify(childIds) === JSON.stringify(['child-a1', 'child-a2']), `children ordered by timestamp ASC (got ${JSON.stringify(childIds)})`);
    assert(rootA.children[0].children[0]?.comment.id === 'grandchild', 'grandchild nested correctly under child-a1');
    assert(rootA.depth === 0 && rootA.children[0].depth === 1 && rootA.children[0].children[0].depth === 2, 'depths computed correctly (0/1/2)');

    // Every input comment appears exactly once across the whole tree.
    function flatten(nodes: typeof tree): string[] {
      const out: string[] = [];
      for (const n of nodes) {
        out.push(n.comment.id);
        out.push(...flatten(n.children));
      }
      return out;
    }
    const allIds = flatten(tree).sort();
    const expectedIds = comments.map((c) => c.id).sort();
    assert(JSON.stringify(allIds) === JSON.stringify(expectedIds), `every input comment appears exactly once (got ${JSON.stringify(allIds)}, expected ${JSON.stringify(expectedIds)})`);

    // Cyclic input must terminate without hanging or duplicating nodes.
    const cyclicComments: FixtureComment[] = [
      { id: 'cy-a', parent_id: 'cy-b', timestamp: 10 },
      { id: 'cy-b', parent_id: 'cy-a', timestamp: 20 },
      { id: 'normal-root', parent_id: null, timestamp: 5 },
    ];
    const cyclicTree = buildCommentTree(cyclicComments);
    const cyclicFlat = flatten(cyclicTree).sort();
    assert(
      JSON.stringify(cyclicFlat) === JSON.stringify(['cy-a', 'cy-b', 'normal-root']),
      `cyclic input terminates and every comment still appears exactly once (got ${JSON.stringify(cyclicFlat)})`
    );
  });

  // -------------------------------------------------------------------
  // Check 6 — countReplies
  // -------------------------------------------------------------------
  runCheck(6, 'countReplies: total descendants, cycle-safe', (assert) => {
    const comments: FixtureComment[] = [
      { id: 'root', parent_id: null, timestamp: 1 },
      { id: 'c1', parent_id: 'root', timestamp: 2 },
      { id: 'c2', parent_id: 'root', timestamp: 3 },
      { id: 'gc1', parent_id: 'c1', timestamp: 4 },
      { id: 'gc2', parent_id: 'c1', timestamp: 5 },
      { id: 'ggc1', parent_id: 'gc1', timestamp: 6 },
      { id: 'unrelated', parent_id: null, timestamp: 7 },
    ];
    assert(countReplies(comments, 'root') === 5, `root has 5 total descendants (got ${countReplies(comments, 'root')})`);
    assert(countReplies(comments, 'c1') === 3, `c1 has 3 total descendants (got ${countReplies(comments, 'c1')})`);
    assert(countReplies(comments, 'unrelated') === 0, 'a leaf/root with no replies counts 0');

    const cyclic: FixtureComment[] = [
      { id: 'x', parent_id: 'y', timestamp: 1 },
      { id: 'y', parent_id: 'x', timestamp: 2 },
    ];
    const n = countReplies(cyclic, 'x');
    assert(Number.isFinite(n), `countReplies terminates on a cyclic parent chain (got ${n})`);
  });

  // -------------------------------------------------------------------
  // Check 7 — checkCommentRateLimit / resetCommentRateLimit
  // -------------------------------------------------------------------
  runCheck(7, 'checkCommentRateLimit: burst limit, per-user isolation, reset, window expiry', (assert) => {
    resetCommentRateLimit();
    const user = 'rl-user-1';
    const other = 'rl-user-2';
    const t0 = 1_000_000;

    for (let i = 0; i < 5; i++) {
      const d = checkCommentRateLimit(user, t0 + i);
      assert(d.allowed === true, `post ${i + 1}/5 within the burst window is allowed`);
      assert(d.retryAfterMs === 0, `post ${i + 1}/5: retryAfterMs === 0 when allowed`);
    }
    const sixth = checkCommentRateLimit(user, t0 + 5);
    assert(sixth.allowed === false, 'the 6th rapid post is blocked');
    assert(sixth.retryAfterMs > 0, `blocked post has retryAfterMs > 0 (got ${sixth.retryAfterMs})`);

    const otherDecision = checkCommentRateLimit(other, t0 + 5);
    assert(otherDecision.allowed === true, 'a different user is unaffected by the first user being rate-limited');

    resetCommentRateLimit(user);
    const afterReset = checkCommentRateLimit(user, t0 + 6);
    assert(afterReset.allowed === true, 'after resetCommentRateLimit(user), the user is allowed again');

    resetCommentRateLimit();
    for (let i = 0; i < 5; i++) checkCommentRateLimit(user, t0 + i);
    const stillBlocked = checkCommentRateLimit(user, t0 + 5);
    assert(stillBlocked.allowed === false, 'precondition: still blocked immediately after the burst');
    const afterWindow = checkCommentRateLimit(user, t0 + 20_001);
    assert(afterWindow.allowed === true, `burst window frees up once 'now' advances past 20s (got allowed=${afterWindow.allowed})`);

    resetCommentRateLimit();
  });

  // -------------------------------------------------------------------
  // Check 8 — formatRelativeTime
  // -------------------------------------------------------------------
  runCheck(8, 'formatRelativeTime: buckets and absolute-date fallback', (assert) => {
    const now = Date.parse('2026-08-16T12:00:00Z');

    assert(formatRelativeTime(now - 10_000, now) === 'just now', '10s ago -> just now');
    assert(formatRelativeTime(now + 5_000, now) === 'just now', 'a future timestamp clamps to just now');
    // The sub-minute band must never floor into "0m ago" — every timestamp
    // under 60s reads as 'just now'.
    for (const seconds of [1, 44, 45, 50, 59]) {
      const label = formatRelativeTime(now - seconds * 1000, now);
      assert(label === 'just now', `${seconds}s ago -> just now (got "${label}")`);
    }
    assert(formatRelativeTime(now - 60_000, now) === '1m ago', 'exactly 60s ago -> "1m ago"');
    assert(formatRelativeTime(now - 5 * 60_000, now) === '5m ago', '5 minutes ago -> "5m ago"');
    assert(formatRelativeTime(now - 3 * 3_600_000, now) === '3h ago', '3 hours ago -> "3h ago"');
    assert(formatRelativeTime(now - 2 * 86_400_000, now) === '2d ago', '2 days ago -> "2d ago"');

    const thirtyDaysAgo = now - 30 * 86_400_000;
    const absolute = formatRelativeTime(thirtyDaysAgo, now);
    const expected = new Date(thirtyDaysAgo).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    assert(absolute === expected, `30 days ago -> absolute date "${expected}" (got "${absolute}")`);
    assert(!absolute.includes('ago'), '30-day-old absolute date does not contain the word "ago"');

    assert(formatRelativeTime(NaN, now) === '', 'a non-finite timestamp returns an empty string');
    assert(formatRelativeTime(Infinity, now) === '', 'Infinity returns an empty string');

    // A date in a different year gets the ", {year}" suffix. Pick a date well
    // clear of a year boundary (mid-year, midday UTC) so this isn't sensitive
    // to the local timezone the test runs in.
    const lastYear = Date.parse('2024-06-15T12:00:00Z');
    const lastYearFormatted = formatRelativeTime(lastYear, now);
    assert(lastYearFormatted.endsWith(', 2024'), `a date in a different year appends ", {year}" (got "${lastYearFormatted}")`);
  });

  // -------------------------------------------------------------------
  // Check 9 — isAllowedReaction
  // -------------------------------------------------------------------
  runCheck(9, 'isAllowedReaction: allowlist membership and type safety', (assert) => {
    for (const emoji of ALLOWED_REACTION_EMOJI) {
      assert(isAllowedReaction(emoji) === true, `${emoji} is allowed`);
    }
    assert(isAllowedReaction('<script>') === false, 'a script-tag-shaped string is rejected');
    assert(isAllowedReaction('') === false, 'empty string is rejected');
    assert(isAllowedReaction('x'.repeat(400)) === false, 'a 400-char string is rejected');
    assert(isAllowedReaction(42) === false, 'a non-string (number) is rejected');
    assert(isAllowedReaction(null) === false, 'a non-string (null) is rejected');
    assert(isAllowedReaction(undefined) === false, 'a non-string (undefined) is rejected');
  });

  // -------------------------------------------------------------------
  // Check 10 — client-bundle safety of the shared module
  // -------------------------------------------------------------------
  // lib/comments.ts ships to the browser. A regex lookbehind is a PARSE
  // error, not a failed match, on Safari < 16.4 — a module-level literal
  // using one would throw at import time and blank the whole page, not just
  // break mentions. Likewise, a server-only import here would break the
  // client build outright. Both are cheap to reintroduce by accident, so
  // they are asserted against the source text.
  runCheck(10, 'lib/comments.ts stays safe to ship to the browser', (assert) => {
    const source = readFileSync(join(__dirname, '..', 'lib', 'comments.ts'), 'utf8');
    assert(!source.includes('(?<='), 'no positive lookbehind (unsupported on Safari < 16.4)');
    assert(!source.includes('(?<!'), 'no negative lookbehind (unsupported on Safari < 16.4)');
    // Match real import statements only — the module's own header comment
    // names these very specifiers when explaining why they are banned.
    const imports = source.split('\n').filter((line) => /^\s*import\b/.test(line));
    for (const banned of ['server-only', '@/lib/db', 'next/', 'react']) {
      const offender = imports.find((line) => line.includes(`'${banned}`) || line.includes(`"${banned}`));
      assert(!offender, `no '${banned}' import in an isomorphic module (found: ${offender ?? 'none'})`);
    }
  });

  // -------------------------------------------------------------------
  console.log('\n' + '='.repeat(78));
  const passed = checksTotal - checksFailed;
  console.log(`  ${passed}/${checksTotal} checks passed`);
  if (checksFailed > 0) {
    console.log('\n  Failures:');
    for (const f of failureSummaries) console.log(`    - ${f}`);
  }
  console.log('='.repeat(78));

  process.exit(checksFailed === 0 ? 0 : 1);
}

main();
