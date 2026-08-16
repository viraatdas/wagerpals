
'use client';
export const dynamic = 'force-dynamic';


import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import Toast, { ToastType } from '@/components/Toast';

function CreateEventForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useUser({ or: "return-null" });
  const [title, setTitle] = useState('');
  const [sides, setSides] = useState(['Yes', 'No']);
  const [paymentType, setPaymentType] = useState<'none' | 'cash'>('none');
  const [stakeMode, setStakeMode] = useState<'fixed' | 'open'>('fixed');
  const [stake, setStake] = useState('10');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [groupMembers, setGroupMembers] = useState<any[]>([]);
  const [membersError, setMembersError] = useState(false);
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [notifySubject, setNotifySubject] = useState(true);

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
    if (!title || sides.some((s) => !s.trim()) || !endDate || !endTime || !user || !selectedGroupId) {
      setToast({ message: 'Please fill in all fields and select a group', type: 'warning' });
      return;
    }

    let stakeAmount: number | null = null;
    if (paymentType === 'cash' && stakeMode === 'fixed') {
      const parsedStake = parseFloat(stake);
      if (isNaN(parsedStake) || parsedStake <= 0 || parsedStake > 500) {
        setToast({ message: 'Stake per player must be between $0.01 and $500.', type: 'warning' });
        return;
      }
      stakeAmount = Math.round(parsedStake * 100) / 100;
    }

    setLoading(true);

    try {
      const endDateTime = new Date(`${endDate}T${endTime}`).getTime();
      const username = user.displayName || user.primaryEmail || 'User';

      const eventData = {
        title: title.trim(),
        side_a: sides[0].trim(),
        side_b: sides[1].trim(),
        end_time: endDateTime,
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
        headers: { 'Content-Type': 'application/json', 'x-stack-user-id': user.id },
        body: JSON.stringify(eventData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to create event:', errorData);
        setToast({ message: errorData.error || 'Failed to create event. Please try again.', type: 'error' });
        return;
      }

      const event = await response.json();
      
      if (event && event.id) {
        router.push(`/events/${event.id}`);
      } else {
        console.error('No event ID returned:', event);
        setToast({ message: 'Event created but could not navigate to it.', type: 'error' });
      }
    } catch (error) {
      console.error('Failed to create event:', error);
      setToast({ message: 'Failed to create event', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return null; // Will redirect to signin
  }

  // Other active members of the selected group, excluding ourselves —
  // you can't make a bet "about" yourself.
  const eligibleSubjects = groupMembers.filter(
    (member) => member.status === 'active' && member.user_id !== user.id
  );

  return (
    <>
      <Toast
        isOpen={toast !== null}
        onClose={() => setToast(null)}
        message={toast?.message || ''}
        type={toast?.type || 'info'}
      />
      <div className="max-w-2xl mx-auto px-4 py-8 animate-rise">
        <h1 className="font-display text-3xl font-semibold text-foreground mb-2">
          Create <span className="text-gradient">Event</span>
        </h1>
        <p className="text-muted font-light mb-8">Set up a new prediction event</p>

      <form onSubmit={handleSubmit} className="glass-strong rounded-3xl p-6 sm:p-8">
        <div className="space-y-8">
          {/* Modern Group Selector */}
          <div>
            <label className="block text-sm font-medium text-muted mb-2">
              Select Group
            </label>
            <div className="relative group-dropdown">
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className={`w-full bg-white border rounded-xl px-5 py-4 flex items-center justify-between transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-2/20 ${
                  selectedGroupId
                    ? 'border-brand-2/40 hover:border-brand-2/60'
                    : 'border-gray-200 hover:border-gray-300'
                } ${dropdownOpen ? 'border-brand-2/60' : ''}`}
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
                      <div className="text-sm text-muted-2 font-light truncate">
                        {groups.find(g => g.id === selectedGroupId)?.member_count || 0} members • ID: {selectedGroupId}
                      </div>
                    </div>
                  </div>
                ) : (
                  <span className="text-muted-2 font-light">Choose a group...</span>
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
                <div className="absolute z-20 w-full mt-2 glass-strong rounded-2xl overflow-hidden max-h-72 overflow-y-auto animate-fade-in">
                  {groups.length === 0 ? (
                    <div className="px-6 py-8 text-center text-muted-2 font-light">
                      No groups available
                    </div>
                  ) : (
                    groups.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => {
                          setSelectedGroupId(group.id);
                          setDropdownOpen(false);
                        }}
                        className={`w-full px-5 py-4 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left ${
                          selectedGroupId === group.id ? 'bg-brand-2/10' : ''
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-semibold flex-shrink-0 ${
                          selectedGroupId === group.id
                            ? 'bg-brand-gradient text-white'
                            : 'bg-gray-100 text-muted'
                        }`}>
                          {group.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-foreground truncate">{group.name}</div>
                          <div className="text-sm text-muted-2 font-light truncate">
                            {group.member_count || 0} members • ID: {group.id}
                          </div>
                        </div>
                        {selectedGroupId === group.id && (
                          <svg className="w-5 h-5 text-brand-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Optional subject picker */}
          {selectedGroupId && membersError && (
            <div>
              <label className="block text-sm font-medium text-muted mb-2">
                Who is this bet about? (optional)
              </label>
              <p className="text-sm text-muted-2 font-light">
                Couldn't load this group's members right now, so this bet won't be tied to anyone in particular.
              </p>
            </div>
          )}

          {selectedGroupId && !membersError && eligibleSubjects.length > 0 && (
            <div>
              <label htmlFor="subject" className="block text-sm font-medium text-muted mb-2">
                Who is this bet about? (optional)
              </label>
              <select
                id="subject"
                aria-label="Who is this bet about?"
                value={selectedSubjectId}
                onChange={(e) => setSelectedSubjectId(e.target.value)}
                className="w-full px-5 py-3.5 bg-white border border-gray-200 shadow-sm text-foreground rounded-xl focus:outline-none focus:border-brand-2/50 focus:ring-2 focus:ring-brand-2/20 transition"
              >
                <option value="">No one / Nobody in particular</option>
                {eligibleSubjects.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.username}
                  </option>
                ))}
              </select>
              <p className="text-sm text-muted-2 font-light mt-2">
                Pick someone if this bet is specifically about them.
              </p>

              {selectedSubjectId && (
                <div className="mt-4 flex items-start gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-pressed={notifySubject}
                    aria-label="Let them know about this bet"
                    onClick={() => setNotifySubject(!notifySubject)}
                    className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-2/20 ${
                      notifySubject ? 'bg-brand-2' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                        notifySubject ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Let them know about this bet
                    </div>
                    {!notifySubject && (
                      <p className="text-sm text-muted-2 font-light mt-1">
                        They won't get any notifications about this bet — not when it's created, when people bet, when someone comments, or when it resolves. It stays off their activity feed until it's resolved. They can still see it if they open the bet directly or browse the group.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <label htmlFor="title" className="block text-sm font-medium text-muted mb-2">
              Event Title
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-5 py-3.5 text-lg bg-white border border-gray-200 shadow-sm text-foreground placeholder:text-muted-2 rounded-xl focus:outline-none focus:border-brand-2/50 focus:ring-2 focus:ring-brand-2/20 transition"
              placeholder="Will it rain tomorrow?"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted mb-2">
              Sides (2-4 options)
            </label>
            <div className="space-y-3 mt-4">
              {sides.map((side, index) => (
                <div key={index} className="flex gap-3 items-center group">
                  <div className="flex-1 relative">
                    <div className={`absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                      index === 0
                        ? 'bg-green-100 text-green-700'
                        : index === 1
                        ? 'bg-red-100 text-red-600'
                        : 'bg-gray-100 text-muted'
                    }`}>
                      {index + 1}
                    </div>
                    <input
                      type="text"
                      value={side}
                      onChange={(e) => handleSideChange(index, e.target.value)}
                      className="w-full pl-14 pr-5 py-3.5 bg-white border border-gray-200 shadow-sm text-foreground placeholder:text-muted-2 rounded-xl focus:outline-none focus:border-brand-2/50 focus:ring-2 focus:ring-brand-2/20 transition"
                      placeholder={`Option ${index + 1}`}
                      required
                    />
                  </div>
                  {sides.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeSide(index)}
                      className="px-4 py-2.5 text-red-600 hover:bg-red-50 border border-red-200 rounded-xl text-sm transition-all hover:border-red-300"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {sides.length < 4 && (
              <button
                type="button"
                onClick={addSide}
                className="mt-4 px-4 py-2.5 text-sm text-brand-2 hover:text-foreground font-medium border border-brand-2/30 rounded-xl hover:bg-brand-2/10 transition-all"
              >
                + Add another option
              </button>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-muted mb-2">
              How are people playing?
            </label>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <button
                type="button"
                onClick={() => setPaymentType('none')}
                className={`px-4 py-3.5 rounded-xl border text-left transition-all ${
                  paymentType === 'none'
                    ? 'border-brand-2 bg-brand-2/10 text-brand-2'
                    : 'border-gray-200 bg-white text-foreground hover:bg-gray-50'
                }`}
              >
                <div className="font-semibold">Just for fun</div>
                <div className="text-sm font-light opacity-80">Points only, no money</div>
              </button>
              <button
                type="button"
                onClick={() => setPaymentType('cash')}
                className={`px-4 py-3.5 rounded-xl border text-left transition-all ${
                  paymentType === 'cash'
                    ? 'border-brand-2 bg-brand-2/10 text-brand-2'
                    : 'border-gray-200 bg-white text-foreground hover:bg-gray-50'
                }`}
              >
                <div className="font-semibold">Real money</div>
                <div className="text-sm font-light opacity-80">Stakes are escrowed from wallets</div>
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
                      className={`px-4 py-2 text-sm font-medium rounded-xl border transition-all ${
                        stakeMode === mode
                          ? 'border-brand-2 bg-brand-2/10 text-brand-2'
                          : 'border-gray-200 bg-white text-foreground hover:bg-gray-50'
                      }`}
                    >
                      {mode === 'fixed' ? 'Fixed stake' : 'Open stake'}
                    </button>
                  ))}
                </div>

                {stakeMode === 'fixed' ? (
                  <div>
                    <label htmlFor="stake" className="block text-sm font-medium text-muted mb-2">
                      Stake per player
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-2">$</span>
                      <input
                        type="number"
                        id="stake"
                        value={stake}
                        onChange={(e) => setStake(e.target.value)}
                        min="0.01"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="10.00"
                        className="w-full pl-8 pr-5 py-3.5 bg-white border border-gray-200 shadow-sm text-foreground placeholder:text-muted-2 rounded-xl focus:outline-none focus:border-brand-2/50 focus:ring-2 focus:ring-brand-2/20 transition"
                      />
                    </div>
                    <p className="text-sm text-muted-2 font-light mt-2">
                      Everyone puts in the same amount. Winners split the whole pot.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-2 font-light">
                    Each player chooses their own stake. Winners split the pot in proportion to what they staked.
                  </p>
                )}

                <p className="text-sm text-muted-2 font-light">
                  Stakes are held in escrow until you resolve the event. Maximum $500 per bet.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-muted mb-2">
              When does this end?
            </label>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-2 text-xl pointer-events-none z-10">
                  📅
                </div>
                <input
                  type="date"
                  id="endDate"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full pl-14 pr-4 py-3.5 bg-white border border-gray-200 shadow-sm text-foreground placeholder:text-muted-2 rounded-xl focus:outline-none focus:border-brand-2/50 focus:ring-2 focus:ring-brand-2/20 transition [color-scheme:light]"
                  required
                />
              </div>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-2 text-xl pointer-events-none z-10">
                  ⏰
                </div>
                <input
                  type="time"
                  id="endTime"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full pl-14 pr-4 py-3.5 bg-white border border-gray-200 shadow-sm text-foreground placeholder:text-muted-2 rounded-xl focus:outline-none focus:border-brand-2/50 focus:ring-2 focus:ring-brand-2/20 transition [color-scheme:light]"
                  required
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-4 text-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:filter-none"
          >
            {loading ? '⏳ Creating Event...' : '✨ Create Event'}
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
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="skeleton h-9 w-48 rounded-xl mb-8" />
        <div className="skeleton h-[28rem] rounded-3xl" />
      </div>
    }>
      <CreateEventForm />
    </Suspense>
  );
}

