// DateTimeField — replaces the old "type YYYY-MM-DD and HH:MM into two text
// boxes" pattern (audit finding D13) with a tap-to-pick control, built in
// pure JS/RN since no native date-picker module is installed. Collapsed, it
// looks like a single row; expanded, it offers quick presets, a horizontal
// day strip, and an hour/minute/AM-PM wheel — never free text, so the value
// handed to `onChange` is always a valid millisecond epoch.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutAnimation,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  addDays,
  addHours,
  addMinutes,
  endOfDay,
  format,
  isBefore,
  isSameDay,
  nextMonday,
  nextSaturday,
  set,
  startOfDay,
} from 'date-fns';
import { colors, easingBezier, font, radius, spacing, tokens } from '../theme';
import { selectionTick, tapLight } from '../utils/haptics';

export interface DateTimeFieldProps {
  label?: string;
  /** Millisecond epoch, or null when nothing has been picked yet. */
  value: number | null;
  /** Fires with a millisecond epoch — this is what `end_time` is on the server. */
  onChange: (timestampMs: number) => void;
  minimumDate?: Date;
  error?: string;
}

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ITEM_HEIGHT = 40;
const VISIBLE_ITEMS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const WHEEL_PADDING = ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2);

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,...,55
const PERIODS: Array<'AM' | 'PM'> = ['AM', 'PM'];

const DAY_STRIP_LENGTH = 30;

/** A safe, always-in-the-future default: an hour from now, rounded up to the next 30-minute mark. */
function defaultTimestamp(minimumDate?: Date): number {
  const floor = minimumDate && minimumDate.getTime() > Date.now() ? minimumDate : new Date();
  const rounded = addMinutes(floor, 60);
  const remainder = rounded.getMinutes() % 30;
  return addMinutes(rounded, remainder === 0 ? 0 : 30 - remainder).getTime();
}

/** Combines a calendar day with an hour/minute/AM-PM selection into a timestamp. */
function combine(day: Date, hour12: number, minute: number, period: 'AM' | 'PM'): number {
  let hour24 = hour12 % 12;
  if (period === 'PM') hour24 += 12;
  return set(day, { hours: hour24, minutes: minute, seconds: 0, milliseconds: 0 }).getTime();
}

function safeDate(ms: number): Date {
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  return isNaN(d.getTime()) ? new Date() : d;
}

interface Preset {
  key: string;
  label: string;
  compute: () => number;
}

const PRESETS: Preset[] = [
  { key: '1h', label: '1 hour', compute: () => addHours(new Date(), 1).getTime() },
  {
    key: 'tonight',
    label: 'Tonight',
    compute: () => {
      const at7pm = set(new Date(), { hours: 19, minutes: 0, seconds: 0, milliseconds: 0 });
      return (isBefore(at7pm, new Date()) ? addDays(at7pm, 1) : at7pm).getTime();
    },
  },
  {
    key: 'tomorrow',
    label: 'Tomorrow',
    compute: () => set(addDays(new Date(), 1), { hours: 12, minutes: 0, seconds: 0, milliseconds: 0 }).getTime(),
  },
  {
    key: 'weekend',
    label: 'This weekend',
    compute: () => set(nextSaturday(new Date()), { hours: 12, minutes: 0, seconds: 0, milliseconds: 0 }).getTime(),
  },
  {
    key: 'nextWeek',
    label: 'Next week',
    compute: () => set(nextMonday(new Date()), { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 }).getTime(),
  },
];

interface WheelColumnProps {
  items: number[] | ('AM' | 'PM')[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  renderLabel: (item: number | 'AM' | 'PM') => string;
  accessibilityLabel: string;
}

/** A single vertically-scrolling, snap-to-item wheel column, styled like an iOS picker wheel. */
function WheelColumn({ items, selectedIndex, onSelect, renderLabel, accessibilityLabel }: WheelColumnProps) {
  const scrollRef = useRef<ScrollView>(null);
  const lastIndex = useRef(selectedIndex);

  useEffect(() => {
    if (lastIndex.current !== selectedIndex) {
      lastIndex.current = selectedIndex;
      scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_HEIGHT, animated: true });
    }
  }, [selectedIndex]);

  const commitIndex = (rawIndex: number) => {
    const clamped = Math.max(0, Math.min(items.length - 1, rawIndex));
    if (clamped !== lastIndex.current) {
      lastIndex.current = clamped;
      selectionTick();
      onSelect(clamped);
    }
  };

  const handleMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    commitIndex(Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT));
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.wheelColumn}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_HEIGHT}
      decelerationRate="fast"
      contentContainerStyle={{ paddingVertical: WHEEL_PADDING }}
      contentOffset={{ x: 0, y: selectedIndex * ITEM_HEIGHT }}
      onMomentumScrollEnd={handleMomentumEnd}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
    >
      {items.map((item, i) => (
        <View key={String(item)} style={styles.wheelItem}>
          <Text style={[styles.wheelItemText, i === selectedIndex && styles.wheelItemTextSelected]}>
            {renderLabel(item)}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

export function DateTimeField({ label, value, onChange, minimumDate, error }: DateTimeFieldProps) {
  const [expanded, setExpanded] = useState(false);
  const [draftMs, setDraftMs] = useState<number>(() => value ?? defaultTimestamp(minimumDate));

  // Stay in sync when the parent resets/changes `value` externally.
  useEffect(() => {
    if (value != null && value !== draftMs) setDraftMs(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const minimumTs = minimumDate ? minimumDate.getTime() : Date.now();
  const draftDate = safeDate(draftMs);

  const days = useMemo(() => {
    const today0 = startOfDay(new Date());
    return Array.from({ length: DAY_STRIP_LENGTH }, (_, i) => addDays(today0, i));
  }, []);

  const toggleExpanded = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    tapLight();
    setExpanded((prev) => !prev);
  };

  /** Every mutation funnels through here so we can guarantee: finite, never NaN, never before minimumDate. */
  const commit = (ts: number) => {
    if (!Number.isFinite(ts)) return;
    const safeTs = Math.max(ts, minimumTs + 60_000);
    setDraftMs(safeTs);
    onChange(safeTs);
  };

  const handlePreset = (preset: Preset) => {
    const ts = preset.compute();
    if (ts < minimumTs) return; // disabled, defensively ignore taps
    selectionTick();
    commit(ts);
  };

  const handleDayPress = (day: Date) => {
    if (endOfDay(day).getTime() < minimumTs) return;
    selectionTick();
    commit(combine(day, hour12, minute, period));
  };

  const hour24 = draftDate.getHours();
  const period: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = ((hour24 + 11) % 12) + 1;
  const minute = draftDate.getMinutes();
  const minuteIndex = Math.min(MINUTES.length - 1, Math.round(minute / 5) % 12);

  const handleHourSelect = (index: number) => commit(combine(draftDate, HOURS[index], minute, period));
  const handleMinuteSelect = (index: number) => commit(combine(draftDate, hour12, MINUTES[index], period));
  const handlePeriodSelect = (index: number) => commit(combine(draftDate, hour12, minute, PERIODS[index]));

  const collapsedLabel = value != null ? format(safeDate(value), "EEE, MMM d '·' h:mm a") : 'Select date & time';

  return (
    <View style={styles.container}>
      {label ? (
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      ) : null}

      <Pressable
        onPress={toggleExpanded}
        accessibilityRole="button"
        accessibilityLabel={label ?? 'Date and time'}
        accessibilityState={{ expanded }}
        style={({ pressed }) => [
          styles.row,
          error && styles.rowError,
          pressed && styles.rowPressed,
        ]}
      >
        <Ionicons name="calendar-outline" size={18} color={colors.brand2} style={styles.rowIcon} />
        <Text style={[styles.rowText, value == null && styles.rowTextPlaceholder]} numberOfLines={1}>
          {collapsedLabel}
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textFaint} />
      </Pressable>

      <View style={styles.errorRow}>
        {error ? (
          <Text style={styles.errorText} numberOfLines={2}>
            {error}
          </Text>
        ) : null}
      </View>

      {expanded ? (
        <View style={styles.panel}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.presetRow}
          >
            {PRESETS.map((preset) => {
              const ts = preset.compute();
              const disabled = ts < minimumTs;
              return (
                <Pressable
                  key={preset.key}
                  onPress={() => handlePreset(preset)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={preset.label}
                  accessibilityState={{ disabled }}
                  style={({ pressed }) => [
                    styles.chip,
                    disabled && styles.chipDisabled,
                    pressed && !disabled && styles.chipPressed,
                  ]}
                >
                  <Text style={[styles.chipText, disabled && styles.chipTextDisabled]}>{preset.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dayStrip}
          >
            {days.map((day) => {
              const disabled = endOfDay(day).getTime() < minimumTs;
              const selected = isSameDay(day, draftDate);
              return (
                <Pressable
                  key={day.toISOString()}
                  onPress={() => handleDayPress(day)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={format(day, 'EEEE, MMMM d')}
                  accessibilityState={{ selected, disabled }}
                  style={({ pressed }) => [
                    styles.dayCard,
                    selected && styles.dayCardSelected,
                    disabled && styles.dayCardDisabled,
                    pressed && !disabled && !selected && styles.dayCardPressed,
                  ]}
                >
                  <Text style={[styles.dayCardWeekday, selected && styles.dayCardTextSelected]}>
                    {format(day, 'EEE')}
                  </Text>
                  <Text style={[styles.dayCardNumber, selected && styles.dayCardTextSelected]}>
                    {format(day, 'd')}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.wheelRow}>
            <View pointerEvents="none" style={styles.wheelHighlight} />
            <WheelColumn
              items={HOURS}
              selectedIndex={hour12 - 1}
              onSelect={handleHourSelect}
              renderLabel={(item) => String(item)}
              accessibilityLabel="Hour"
            />
            <WheelColumn
              items={MINUTES}
              selectedIndex={minuteIndex}
              onSelect={handleMinuteSelect}
              renderLabel={(item) => String(item).padStart(2, '0')}
              accessibilityLabel="Minute"
            />
            <WheelColumn
              items={PERIODS}
              selectedIndex={period === 'AM' ? 0 : 1}
              onSelect={handlePeriodSelect}
              renderLabel={(item) => String(item)}
              accessibilityLabel="AM or PM"
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  label: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  rowError: {
    borderColor: colors.rose,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowIcon: {
    marginRight: spacing.sm,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.base,
    color: colors.text,
  },
  rowTextPlaceholder: {
    fontFamily: font.sans,
    color: colors.textFaint,
  },
  errorRow: {
    marginTop: spacing.xs,
    minHeight: 16,
  },
  errorText: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.xs,
    color: colors.rose,
  },
  panel: {
    marginTop: spacing.md,
    backgroundColor: colors.bg2,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  presetRow: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipPressed: {
    backgroundColor: colors.brandFill,
    borderColor: colors.brand2,
  },
  chipDisabled: {
    opacity: 0.4,
  },
  chipText: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.sm,
    color: colors.text,
  },
  chipTextDisabled: {
    color: colors.textFaint,
  },
  dayStrip: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  dayCard: {
    width: 52,
    minHeight: 64,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  dayCardPressed: {
    borderColor: colors.brand2,
  },
  dayCardSelected: {
    backgroundColor: colors.brand2,
    borderColor: colors.brand2,
  },
  dayCardDisabled: {
    opacity: 0.35,
  },
  dayCardWeekday: {
    fontFamily: font.monoMedium,
    fontSize: tokens.fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  dayCardNumber: {
    fontFamily: font.monoMedium,
    fontSize: tokens.fontSize.lg,
    color: colors.text,
  },
  dayCardTextSelected: {
    color: colors.white,
  },
  wheelRow: {
    flexDirection: 'row',
    height: WHEEL_HEIGHT,
    position: 'relative',
    alignItems: 'center',
  },
  wheelHighlight: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: WHEEL_PADDING,
    height: ITEM_HEIGHT,
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  wheelColumn: {
    flex: 1,
    height: WHEEL_HEIGHT,
  },
  wheelItem: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelItemText: {
    fontFamily: font.mono,
    fontSize: tokens.fontSize.lg,
    color: colors.textFaint,
    fontVariant: ['tabular-nums'],
  },
  wheelItemTextSelected: {
    fontFamily: font.monoMedium,
    color: colors.text,
  },
});
