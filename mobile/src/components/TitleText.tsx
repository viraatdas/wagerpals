// Renders a wager TITLE with @mentions picked out in Amber — the "people"
// accent (MOBILE-SPEC.md / DESIGN-SPEC.md color rule: numbers are
// emerald/crimson, people are amber). Nested <Text> runs so RN can style the
// mention spans without breaking line wrapping. Single place that splits a
// title on @handles for display; every title render site should use this
// instead of a per-site regex. Titles inside editable inputs stay plain
// strings — this is read-only, never used to build/parse mention syntax.
import React from 'react';
import { Text, StyleProp, TextStyle } from 'react-native';
import { colors, font } from '../theme';

const MENTION_PATTERN = /@[a-zA-Z0-9_]+/g;

export interface TitleTextProps {
  title: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip';
}

export function TitleText({ title, style, numberOfLines, ellipsizeMode }: TitleTextProps) {
  const parts = title.split(MENTION_PATTERN);
  const mentions = title.match(MENTION_PATTERN) ?? [];

  return (
    <Text style={style} numberOfLines={numberOfLines} ellipsizeMode={ellipsizeMode}>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {part}
          {i < mentions.length ? (
            <Text style={{ fontFamily: font.sansMedium, color: colors.amber }}>{mentions[i]}</Text>
          ) : null}
        </React.Fragment>
      ))}
    </Text>
  );
}

export default TitleText;
