// ListRow — the canonical settings/list row: leading slot, title/subtitle
// stack, trailing slot, optional chevron. The title/subtitle column uses
// flexShrink so a long title truncates instead of squeezing the trailing
// slot (balance, chevron, etc.) off-screen.
import React from 'react';
import { View, Text, Pressable, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, spacing, tokens } from '../theme';
import { tapLight } from '../utils/haptics';

export interface ListRowProps {
  leading?: React.ReactNode;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
  /** Renders the title in the "no"/rose token — for destructive rows like
   * "Delete group" or "Leave group". */
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export const ListRow = React.memo(function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onPress,
  showChevron = false,
  destructive = false,
  style,
  accessibilityLabel,
}: ListRowProps) {
  const content = (
    <View style={styles.row}>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.textCol}>
        <Text
          style={[styles.title, destructive && styles.destructiveText]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="tail">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      {showChevron ? (
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} style={styles.chevron} />
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        onPress={() => {
          tapLight();
          onPress();
        }}
        style={({ pressed }) => [styles.container, pressed && styles.pressed, style]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={[styles.container, style]}>{content}</View>;
});

export default ListRow;

const styles = StyleSheet.create({
  container: {
    minHeight: 44,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.bg2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leading: {
    marginRight: spacing.md,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  title: {
    fontFamily: font.sansMedium,
    fontSize: tokens.fontSize.base,
    color: colors.text,
  },
  destructiveText: {
    color: colors.rose,
  },
  subtitle: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    marginTop: 2,
  },
  trailing: {
    marginLeft: spacing.md,
    flexShrink: 0,
  },
  chevron: {
    marginLeft: spacing.xs,
    flexShrink: 0,
  },
});
