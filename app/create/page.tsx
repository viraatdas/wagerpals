
'use client';
export const dynamic = 'force-dynamic';


import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import Toast, { ToastType } from '@/components/Toast';
import ConfidenceBar from '@/components/ConfidenceBar';
import { WMark } from '@/components/WMark';
import { useMentionAutocomplete, MentionAutocompleteMenu } from '@/components/useMentionAutocomplete';
import { handle } from '@/lib/utils';

// Small checkmark used to mark a "selected" choice — selection is never
// conveyed by colour alone (a heavier border always accompanies it).
function SelectedCheck({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`tone-text flex-none ${className}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CreateEventForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useUser({ or: "return-null" });
  const [title, setTitle] = useState('');
  const [sides, setSides] = useState(['Yes', 'No']);
  const [paymentType, setPaymentType] = useState<'none' | 'cash'>('none');
  const [stakeMode, setStakeMode] = useState<'fixed' | 'open'>('fixed');
  const [stake, setStake] = useState('10');
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [groupMembers, setGroupMembers] = useState<any[]>([]);
  const [membersError, setMembersError] = useState(false);
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [notifySubject, setNotifySubject] = useState(true);
  // Presentation-only: tracks whether the user has tried to submit, so
  // inline field errors only appear after a real attempt. Does not change
  // what gets validated or how — see handleSubmit, which is unchanged.
  const [attempted, setAttempted] = useState(false);

  // Other active members of the selected group, excluding ourselves —
  // you can't make a bet "about" yourself. Also doubles as the @mention
  // candidate list for the title field below.
  const eligibleSubjects = groupMembers.filter(
    (member) => member.status === 'active' && member.user_id !== user?.id
  );

  // @mention autocomplete for the title field, reusing the same shared
  // machinery CommentForm uses and the same candidate list already fetched
  // for the "who is this bet about" picker below. Called unconditionally
  // (before the `if (!user)` early return) so hook order never changes
  // between renders.
  const {
    popupOpen: titleMentionOpen,
    candidates: titleMentionCandidates,
    clampedHighlight: titleMentionHighlight,
    listboxId: titleMentionListboxId,
    activeOptionId: titleMentionActiveOptionId,
    inputRef: titleInputRef,
    updateFromElement: updateTitleMentionState,
    handleKeyDown: handleTitleMentionKeyDown,
    acceptMention: acceptTitleMention,
  } = useMentionAutocomplete<HTMLInputElement>({ members: eligibleSubjects, value: title, onChange: setTitle });

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin');
      return;
    }

    fetchGroups(user.id);

    // Get groupId from URL if present
    const groupIdFromUrl = searchParams.get('groupId');
    if (groupIdFromUrl) {
      setSelectedGroupId(groupIdFromUrl);
    }
  }, [searchParams, user, router]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (dropdownOpen && !target.closest('.group-dropdown')) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  // Load members of the selected group so we can offer the "who is this bet
  // about" picker. Always reset the subject when the group changes.
  useEffect(() => {
    setSelectedSubjectId('');
    setNotifySubject(true);
    setGroupMembers([]);
    setMembersError(false);

    if (!selectedGroupId) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/groups/members?groupId=${selectedGroupId}`);
        if (!response.ok) throw new Error('Failed to fetch group members');
        const data = await response.json();
        if (!cancelled) {
          setGroupMembers(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        console.error('Failed to fetch group members:', error);
        if (!cancelled) {
          setGroupMembers([]);
          setMembersError(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedGroupId]);

  // The selected group decides whether cash wagers are even an option here —
  // it's a group-level setting, not a per-event choice. If the group changes
  // out from under a 'cash' selection (or never allowed it), fall back to
  // 'none' rather than silently submitting a cash event the server will reject.
  const selectedGroup = groups.find((g) => g.id === selectedGroupId);
  const cashAvailable = !!selectedGroup?.cash_enabled;

  useEffect(() => {
    if (!cashAvailable && paymentType === 'cash') {
      setPaymentType('none');
    }
  }, [cashAvailable, paymentType]);

  const fetchGroups = async (uid: string) => {
    try {
      const response = await fetch(`/api/groups?userId=${uid}`);
      if (!response.ok) throw new Error('Failed to fetch groups');
      const data = await response.json();
      setGroups(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch groups:', error);
      setGroups([]);
    }
  };

  const handleSideChange = (index: number, value: string) => {
    const newSides = [...sides];
    newSides[index] = value;
    setSides(newSides);
  };

  const addSide = () => {
    if (sides.length < 4) {
      setSides([...sides, '']);
    }
  };

  const removeSide = (index: number) => {
    if (sides.length > 2) {
      setSides(sides.filter((_, i) => i !== index));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (!title || sides.some((s) => !s.trim()) || !user || !selectedGroupId) {
      setToast({ message: 'Fill in every field and pick a group.', type: 'warning' });
      return;
    }

    let stakeAmount: number | null = null;
    if (paymentType === 'cash' && stakeMode === 'fixed') {
      const parsedStake = parseFloat(stake);
      if (isNaN(parsedStake) || parsedStake <= 0 || parsedStake > 500) {
        setToast({ message: 'Stake per bettor must be between $0.01 and $500.', type: 'warning' });
        return;
      }
      stakeAmount = Math.round(parsedStake * 100) / 100;
    }

    setLoading(true);

    try {
      const username = user.displayName || user.primaryEmail || 'User';

      // R1: events never expire — end_time is omitted; the server fills a
      // meaningless placeholder purely to satisfy the NOT NULL column.
      const eventData = {
        title: title.trim(),
        side_a: sides[0].trim(),
        side_b: sides[1].trim(),
        group_id: selectedGroupId,
        creator_user_id: user.id,
        creator_username: username,
        payment_type: paymentType,
        stake_amount: stakeAmount,
        subject_user_id: selectedSubjectId || null,
        notify_subject: selectedSubjectId ? notifySubject : true,
      };

      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to create event:', errorData);
        setToast({ message: errorData.error || "Couldn't create the event. Try again.", type: 'error' });
        return;
      }

      const event = await response.json();

      if (event && event.id) {
        router.push(`/events/${event.id}`);
      } else {
        console.error('No event ID returned:', event);
        setToast({ message: 'Event created. Open it from your groups.', type: 'error' });
      }
    } catch (error) {
      console.error('Failed to create event:', error);
      setToast({ message: "Couldn't create the event. Try again.", type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return null; // Will redirect to signin
  }

  // Derived, presentation-only validity flags — same rules handleSubmit
  // already enforces, just echoed inline once the user has tried to submit.
  const stakeAmountInvalid =
    attempted &&
    paymentType === 'cash' &&
    stakeMode === 'fixed' &&
    (() => {
      const n = parseFloat(stake);
      return isNaN(n) || n <= 0 || n > 500;
    })();

  return (
    <>
      <Toast
        isOpen={toast !== null}
        onClose={() => setToast(null)}
        message={toast?.message || ''}
        type={toast?.type || 'info'}
      />
      <div className="page-shell-narrow mobile-page animate-rise">
        <div className="mb-8">
          <p className="eyebrow eyebrow-accent mb-2">New market</p>
          <h1 className="display-2">Create an event</h1>
          <p className="lede mt-2">Set the terms, then let your group start betting.</p>
        </div>

      <form onSubmit={handleSubmit} className="card-focal p-6 sm:p-8">
        <div className="space-y-9">
          {/* The group */}
          <div>
            <div className="section-head mb-4">
              <span className="eyebrow">The group</span>
            </div>
            <span id="group-label" className="field-label">Group</span>
            <div className="relative group-dropdown">
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                aria-labelledby="group-label"
                aria-haspopup="listbox"
                aria-expanded={dropdownOpen}
                className={`input press flex items-center justify-between text-left ${
                  attempted && !selectedGroupId ? 'input-invalid' : ''
                }`}
              >
                {selectedGroupId ? (
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-brand-gradient rounded-xl flex items-center justify-center text-white font-semibold flex-shrink-0">
                      {groups.find(g => g.id === selectedGroupId)?.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-left min-w-0">
                      <div className="font-medium text-foreground truncate">
                        {groups.find(g => g.id === selectedGroupId)?.name}
                      </div>
                      <div className="text-sm text-muted truncate">
                        {groups.find(g => g.id === selectedGroupId)?.member_count || 0} members
                      </div>
                    </div>
                  </div>
                ) : (
                  <span className="text-muted">Choose a group…</span>
                )}
                <svg
                  className={`w-5 h-5 text-muted-2 transition-transform flex-shrink-0 ${dropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown Menu */}
              {dropdownOpen && (
                <div className="card absolute z-20 w-full mt-2 overflow-hidden max-h-72 overflow-y-auto animate-sheet" role="listbox">
                  {groups.length === 0 ? (
                    <div className="px-6 py-8 text-center text-muted">
                      No groups available
                    </div>
                  ) : (
                    groups.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        role="option"
                        aria-selected={selectedGroupId === group.id}
                        onClick={() => {
                          setSelectedGroupId(group.id);
                          setDropdownOpen(false);
                        }}
                        className={`press w-full px-5 py-4 flex items-center gap-3 transition-colors text-left ${
                          selectedGroupId === group.id ? 'tone-accent tone-surface' : 'hover:bg-surface-sunken'
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-semibold flex-shrink-0 ${
                          selectedGroupId === group.id
                            ? 'bg-brand-gradient text-white'
                            : 'bg-surface-sunken text-muted'
                        }`}>
                          {group.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-foreground truncate">{group.name}</div>
                          <div className="text-sm text-muted truncate">
                            {group.member_count || 0} members
                          </div>
                        </div>
                        {selectedGroupId === group.id && <SelectedCheck />}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {attempted && !selectedGroupId ? (
              <p className="tone-no tone-text field-hint mt-2">Select a group to continue.</p>
            ) : (
              <p className="field-hint mt-2">Only this group will see and be able to bet on this event.</p>
            )}

            {/* Subject picker — this bet can be about a specific group
                member. Amber throughout: amber is the "person" accent
                (never money), and reusing the verified tone-pending fill
                keeps it inside the existing AA-safe amber tone rather than
                inventing a new border/fill pair. */}
            {selectedGroupId && membersError && (
              <div className="tone-pending tone-surface border rounded-panel p-4 mt-5">
                <p className="field-label mb-1">This bet is about someone (optional)</p>
                <p className="tone-text text-sm">
                  Couldn&apos;t load this group&apos;s members right now, so this bet won&apos;t be tied to anyone in particular.
                </p>
              </div>
            )}

            {selectedGroupId && !membersError && eligibleSubjects.length > 0 && (
              <div className="tone-pending tone-surface border rounded-panel p-4 mt-5">
                <label htmlFor="subject" className="field-label">This bet is about someone (optional)</label>
                <select
                  id="subject"
                  aria-label="This bet is about someone"
                  value={selectedSubjectId}
                  onChange={(e) => setSelectedSubjectId(e.target.value)}
                  className="input mt-1"
                >
                  <option value="">No one / Nobody in particular</option>
                  {eligibleSubjects.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {handle(member.username)}
                    </option>
                  ))}
                </select>
                <p className="field-hint mt-2">
                  Pick someone if this bet is specifically about them.
                </p>

                {selectedSubjectId && (
                  <div className="mt-4 flex items-start gap-3 border-t border-amber/30 pt-4">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!notifySubject}
                      aria-label="Keep it secret from them"
                      onClick={() => setNotifySubject(!notifySubject)}
                      className={`press relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors ${
                        !notifySubject ? 'bg-amber' : 'bg-surface-elevated'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-ink shadow-elev-1 transition-transform ${
                          !notifySubject ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        Keep it secret from them
                      </div>
                      {!notifySubject && (
                        <p className="field-hint mt-1">They won&apos;t see this bet anywhere.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* The question */}
          <div>
            <div className="section-head mb-4">
              <span className="eyebrow">The question</span>
            </div>
            <label htmlFor="title" className="field-label">Event title</label>
            <div className="relative">
              <input
                type="text"
                id="title"
                ref={titleInputRef}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  updateTitleMentionState(e.target);
                }}
                onKeyDown={(e) => {
                  handleTitleMentionKeyDown(e);
                }}
                onKeyUp={(e) => updateTitleMentionState(e.currentTarget)}
                onClick={(e) => updateTitleMentionState(e.currentTarget)}
                className={`input text-lg ${attempted && !title.trim() ? 'input-invalid' : ''}`}
                placeholder="Will it rain tomorrow?"
                required
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={titleMentionOpen}
                aria-controls={titleMentionListboxId}
                aria-activedescendant={titleMentionActiveOptionId}
              />
              {titleMentionOpen && (
                <MentionAutocompleteMenu
                  listboxId={titleMentionListboxId}
                  candidates={titleMentionCandidates}
                  clampedHighlight={titleMentionHighlight}
                  onPick={acceptTitleMention}
                />
              )}
            </div>
            {attempted && !title.trim() ? (
              <p className="tone-no tone-text field-hint mt-2">Give the market a question.</p>
            ) : (
              <p className="field-hint mt-2">
                This is the headline everyone in the group will see.
                {eligibleSubjects.length > 0 && ' Type @ to tag someone.'}
              </p>
            )}
          </div>

          {/* The two sides */}
          <div>
            <div className="section-head mb-4">
              <span className="eyebrow">The two sides</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="tone-yes tone-surface border rounded-card p-4">
                <label htmlFor="side-0" className="field-label flex items-center gap-2">
                  <span className="tone-dot" aria-hidden="true" />
                  Side A
                </label>
                <input
                  type="text"
                  id="side-0"
                  value={sides[0]}
                  onChange={(e) => handleSideChange(0, e.target.value)}
                  className={`input ${attempted && !sides[0].trim() ? 'input-invalid' : ''}`}
                  placeholder="Option 1"
                  required
                />
              </div>
              <div className="tone-no tone-surface border rounded-card p-4">
                <label htmlFor="side-1" className="field-label flex items-center gap-2">
                  <span className="tone-dot" aria-hidden="true" />
                  Side B
                </label>
                <input
                  type="text"
                  id="side-1"
                  value={sides[1]}
                  onChange={(e) => handleSideChange(1, e.target.value)}
                  className={`input ${attempted && !sides[1].trim() ? 'input-invalid' : ''}`}
                  placeholder="Option 2"
                  required
                />
              </div>
            </div>

            {sides.length > 2 && (
              <div className="space-y-3 mt-3">
                {sides.slice(2).map((side, i) => {
                  const index = i + 2;
                  return (
                    <div key={index} className="tone-neutral tone-surface border rounded-card p-4 flex gap-3 items-end">
                      <div className="flex-1">
                        <label htmlFor={`side-${index}`} className="field-label">Option {index + 1}</label>
                        <input
                          type="text"
                          id={`side-${index}`}
                          value={side}
                          onChange={(e) => handleSideChange(index, e.target.value)}
                          className={`input ${attempted && !side.trim() ? 'input-invalid' : ''}`}
                          placeholder={`Option ${index + 1}`}
                          required
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSide(index)}
                        aria-label={`Remove option ${index + 1}`}
                        className="btn-quiet-danger press"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {attempted && sides.some((s) => !s.trim()) && (
              <p className="tone-no tone-text field-hint mt-2">Fill in every side.</p>
            )}

            {sides.length < 4 && (
              <button
                type="button"
                onClick={addSide}
                className="press mt-3 text-sm text-emerald hover:text-foreground font-medium border border-emerald/30 rounded-control px-4 py-2.5 hover:bg-emerald/10 transition-all"
              >
                + Add another option
              </button>
            )}

            {/* Compact live preview, built purely from form state above — the
                same signature ConfidenceBar every other wager surface uses,
                resting at an even split since no bets exist yet. */}
            <div className="panel p-5 mt-5">
              <p className="eyebrow mb-3">Preview</p>
              <p className="market-title text-lg mb-4">
                {title.trim() || 'Your question will appear here'}
              </p>
              <ConfidenceBar
                sideA={{ label: sides[0]?.trim() || 'Side A', total: 1 }}
                sideB={{ label: sides[1]?.trim() || 'Side B', total: 1 }}
                size="compact"
              />
            </div>
          </div>

          {/* Stakes — the cash option only appears when the selected group has
              cash wagers turned on; otherwise every event in that group is
              points-only, with no choice to show. */}
          {cashAvailable && (
          <div>
            <div className="section-head mb-4">
              <span className="eyebrow">Stakes</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPaymentType('none')}
                aria-pressed={paymentType === 'none'}
                className={`press text-left rounded-control p-4 transition-all ${
                  paymentType === 'none'
                    ? 'tone-accent tone-surface border-2'
                    : 'border border-hairline bg-surface text-foreground hover:bg-surface-elevated'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">Play with W</span>
                  {paymentType === 'none' && <SelectedCheck />}
                </div>
                <div className="flex items-center gap-1 text-sm text-muted mt-0.5">
                  Stakes <WMark className="h-3 w-3" />, no real money
                </div>
              </button>
              <button
                type="button"
                onClick={() => setPaymentType('cash')}
                aria-pressed={paymentType === 'cash'}
                className={`press text-left rounded-control p-4 transition-all ${
                  paymentType === 'cash'
                    ? 'tone-accent tone-surface border-2'
                    : 'border border-hairline bg-surface text-foreground hover:bg-surface-elevated'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">Real money</span>
                  {paymentType === 'cash' && <SelectedCheck />}
                </div>
                <div className="text-sm text-muted mt-0.5">Stakes are escrowed from wallets</div>
              </button>
            </div>

            {paymentType === 'cash' && (
              <div className="mt-5 space-y-4">
                <div className="flex gap-2.5">
                  {(['fixed', 'open'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setStakeMode(mode)}
                      aria-pressed={stakeMode === mode}
                      className={`press inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-control transition-all ${
                        stakeMode === mode
                          ? 'tone-accent tone-surface border-2'
                          : 'border border-hairline bg-surface text-foreground hover:bg-surface-elevated'
                      }`}
                    >
                      {stakeMode === mode && <SelectedCheck className="h-3.5 w-3.5" />}
                      {mode === 'fixed' ? 'Fixed stake' : 'Open stake'}
                    </button>
                  ))}
                </div>

                {stakeMode === 'fixed' ? (
                  <div>
                    <label htmlFor="stake" className="field-label">Stake per bettor</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-muted pointer-events-none">$</span>
                      <input
                        type="number"
                        id="stake"
                        value={stake}
                        onChange={(e) => setStake(e.target.value)}
                        min="0.01"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="10.00"
                        className={`input font-mono pl-8 ${stakeAmountInvalid ? 'input-invalid' : ''}`}
                      />
                    </div>
                    {stakeAmountInvalid ? (
                      <p className="tone-no tone-text field-hint mt-2">Stake must be between $0.01 and $500.</p>
                    ) : (
                      <p className="field-hint mt-2">
                        Everyone puts in the same amount. Winners split the whole pot.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="field-hint">
                    Each bettor chooses their own stake. Winners split the pot in proportion to what they staked.
                  </p>
                )}

                <p className="field-hint">
                  We hold stakes in escrow until you resolve the event. Maximum $500 per bet.
                </p>
              </div>
            )}
          </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary on-accent press w-full py-4 text-base sm:text-lg disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-ink-inverse/80 animate-pulse" aria-hidden="true" />
                Creating…
              </span>
            ) : (
              'Create event'
            )}
          </button>
        </div>
      </form>
      </div>
    </>
  );
}

export default function CreateEvent() {
  return (
    <Suspense fallback={
      <div className="page-shell-narrow mobile-page">
        <div className="skeleton-line h-4 w-24 mb-3" />
        <div className="skeleton h-9 w-64 rounded-xl mb-8" />
        <div className="skeleton h-[36rem] rounded-[1.75rem]" />
      </div>
    }>
      <CreateEventForm />
    </Suspense>
  );
}
