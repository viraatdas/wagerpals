
'use client';
export const dynamic = 'force-dynamic';


import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import Toast, { ToastType } from '@/components/Toast';
import ConfidenceBar from '@/components/ConfidenceBar';
import { useMentionAutocomplete, MentionAutocompleteMenu } from '@/components/useMentionAutocomplete';
import { handle } from '@/lib/utils';

// Escapes a string for safe interpolation into a RegExp source.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [groupMembers, setGroupMembers] = useState<any[]>([]);
  // Who this bet is hidden from, if anyone — empty string means "hidden from
  // no one". Only ever set to a member currently @mentioned in the title
  // (see mentionedMembers below); there is no standalone subject picker.
  const [hideFromId, setHideFromId] = useState('');
  // Presentation-only: tracks whether the user has tried to submit, so
  // inline field errors only appear after a real attempt. Does not change
  // what gets validated or how — see handleSubmit, which is unchanged.
  const [attempted, setAttempted] = useState(false);

  // Other active members of the selected group, excluding ourselves —
  // you can't hide a bet from yourself. Also the @mention candidate list
  // for the title field below.
  const eligibleSubjects = groupMembers.filter(
    (member) => member.status === 'active' && member.user_id !== user?.id
  );

  // Members mentioned by @username in the title right now — this is the
  // sole source of "who can this bet be hidden from" (no standalone
  // subject picker). Matches a member whenever their exact @username
  // appears as a token in the title text. Memoized so the effect below
  // (which clears a stale hide-from selection) only re-runs when the set
  // of mentioned members actually changes, not on every keystroke.
  const mentionedMembers = useMemo(
    () =>
      eligibleSubjects.filter((member) => {
        const re = new RegExp(`(?:^|[\\s([{"',:;-])@${escapeRegExp(member.username)}(?=$|[^A-Za-z0-9_])`, 'i');
        return re.test(title);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, groupMembers, user?.id]
  );

  // If a mention is deleted from the title (or the group changes underneath
  // us), a previously-picked "hide from" selection can point at someone who
  // is no longer mentioned. Clear it rather than silently keep hiding the
  // bet from someone the title no longer names.
  useEffect(() => {
    if (hideFromId && !mentionedMembers.some((m) => m.user_id === hideFromId)) {
      setHideFromId('');
    }
  }, [hideFromId, mentionedMembers]);

  // @mention autocomplete for the title field, reusing the same shared
  // machinery CommentForm uses and the same candidate list already fetched
  // above. Called unconditionally (before the `if (!user)` early return) so
  // hook order never changes between renders.
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

  // Load members of the selected group so we can rank @mention candidates.
  // Always reset the hide-from selection when the group changes.
  useEffect(() => {
    setHideFromId('');
    setGroupMembers([]);

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
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedGroupId]);

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

    setLoading(true);

    try {
      const username = user.displayName || user.primaryEmail || 'User';

      // R1: events never expire — end_time is omitted; the server fills a
      // meaningless placeholder purely to satisfy the NOT NULL column.
      // payment_type: dollar consolidation removed the "play with W" vs
      // "real money" choice — every wager stakes dollars now, so this
      // always sends 'cash'. stake_amount is omitted entirely — there is no
      // stake input at creation; each bettor picks their own amount when
      // they place a bet.
      // subject_user_id/notify_subject are sent only when the "Hide this
      // from @x" toggle is actually on — a mention alone is just text, not
      // a hide request.
      const eventData = {
        title: title.trim(),
        side_a: sides[0].trim(),
        side_b: sides[1].trim(),
        group_id: selectedGroupId,
        creator_user_id: user.id,
        creator_username: username,
        payment_type: 'cash' as const,
        subject_user_id: hideFromId || null,
        notify_subject: hideFromId ? false : true,
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

          </div>

          {/* The question */}
          <div>
            <div className="section-head mb-4">
              <span className="eyebrow">The question</span>
            </div>
            <label htmlFor="title" className="field-label">Event</label>
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

            {/* Detected from @mentions in the title above — no standalone
                subject picker. Amber throughout: amber is the "person"
                accent (never money), reusing the verified tone-pending fill
                so it stays inside the existing AA-safe amber tone rather
                than inventing a new border/fill pair. Renders nothing at
                all when no one is mentioned. */}
            {mentionedMembers.length === 1 && (
              <div className="tone-pending tone-surface border rounded-panel p-4 mt-4">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={hideFromId === mentionedMembers[0].user_id}
                    aria-label={`Hide this bet from ${handle(mentionedMembers[0].username)}`}
                    onClick={() =>
                      setHideFromId((current) =>
                        current === mentionedMembers[0].user_id ? '' : mentionedMembers[0].user_id
                      )
                    }
                    className={`press relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors ${
                      hideFromId === mentionedMembers[0].user_id ? 'bg-amber' : 'bg-surface-elevated'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-ink shadow-elev-1 transition-transform ${
                        hideFromId === mentionedMembers[0].user_id ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Hide this bet from {handle(mentionedMembers[0].username)}
                    </div>
                    {hideFromId === mentionedMembers[0].user_id && (
                      <p className="field-hint mt-1">They won&apos;t see this bet anywhere.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {mentionedMembers.length > 1 && (
              <div className="tone-pending tone-surface border rounded-panel p-4 mt-4">
                <p className="field-label mb-3">Keep it secret from them</p>
                <div className="flex flex-wrap gap-2">
                  {mentionedMembers.map((member) => {
                    const selected = hideFromId === member.user_id;
                    return (
                      <button
                        key={member.user_id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setHideFromId((current) => (current === member.user_id ? '' : member.user_id))}
                        className={`press inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors ${
                          selected
                            ? 'border-amber bg-amber text-ink-inverse'
                            : 'border-amber/40 bg-amber/10 text-amber-ink hover:bg-amber/20'
                        }`}
                      >
                        {handle(member.username)}
                      </button>
                    );
                  })}
                </div>
                <p className="field-hint mt-3">
                  Pick who shouldn&apos;t see it. One person max for now.
                </p>
                {hideFromId && (
                  <p className="field-hint mt-1">They won&apos;t see this bet anywhere.</p>
                )}
              </div>
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
