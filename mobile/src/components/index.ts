// Component barrel. Screens should import from '../components', not from
// individual files, so the shared UI kit stays discoverable in one place.

// --- Core primitives -------------------------------------------------------
export { default as ErrorBoundary, type ErrorBoundaryProps } from './ErrorBoundary';
export { LoadingState, EmptyState, ErrorState } from './ScreenState';
export type { LoadingStateProps, EmptyStateProps, ErrorStateProps } from './ScreenState';
export { Skeleton, SkeletonCard, SkeletonList, type SkeletonProps } from './Skeleton';
export { Card, type CardProps } from './Card';
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize, type ButtonHaptic } from './Button';
export { Pill, type PillProps, type PillTone, type PillSize } from './Pill';
export { Avatar, type AvatarProps, type AvatarSize } from './Avatar';
export { SectionHeader, type SectionHeaderProps } from './SectionHeader';
export { Money, type MoneyProps, type MoneySize, type MoneyTone } from './Money';
export { TitleText, type TitleTextProps } from './TitleText';
export { ListRow, type ListRowProps } from './ListRow';
export { ProgressBar, SplitBar, type ProgressBarProps, type SplitBarProps, type ProgressTone } from './ProgressBar';

// --- Form controls ---------------------------------------------------------
export { FormScreen, type FormScreenProps } from './FormScreen';
export { Field, type FieldProps } from './Field';
export { DateTimeField, type DateTimeFieldProps } from './DateTimeField';
export { AmountInput, type AmountInputProps } from './AmountInput';
export { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from './SegmentedControl';
export { Toggle, type ToggleProps } from './Toggle';
export { UserPicker, type UserPickerProps, type UserPickerUser } from './UserPicker';
export { BottomSheet, type BottomSheetProps } from './BottomSheet';
export { default as TextInputModal } from './TextInputModal';
