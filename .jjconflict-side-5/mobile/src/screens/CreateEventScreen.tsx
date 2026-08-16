import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { colors, gradients, radius, glow, inputStyle } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { tapMedium, success, error as hapticError } from '../utils/haptics';

type CreateEventRouteProps = RouteProp<RootStackParamList, 'CreateEvent'>;

export default function CreateEventScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<CreateEventRouteProps>();
  const { user } = useAuth();
  const { groupId } = route.params;

  const [title, setTitle] = useState('');
  const [sideA, setSideA] = useState('');
  const [sideB, setSideB] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!user) {
      Alert.alert('Error', 'You must be logged in to create an event.');
      return;
    }

    if (!title.trim()) {
      Alert.alert('Missing Field', 'Please enter an event title.');
      return;
    }
    if (!sideA.trim() || !sideB.trim()) {
      Alert.alert('Missing Field', 'Please enter names for both sides.');
      return;
    }
    if (!endDate.trim() || !endTime.trim()) {
      Alert.alert('Missing Field', 'Please enter an end date and time.');
      return;
    }

    // Parse date/time — expected formats: YYYY-MM-DD and HH:MM
    const dateTimeString = `${endDate.trim()}T${endTime.trim()}`;
    const parsedTime = new Date(dateTimeString).getTime();

    if (isNaN(parsedTime)) {
      Alert.alert('Invalid Date', 'Please enter date as YYYY-MM-DD and time as HH:MM.');
      return;
    }

    if (parsedTime <= Date.now()) {
      Alert.alert('Invalid Date', 'End time must be in the future.');
      return;
    }

    tapMedium();
    setIsSubmitting(true);

    try {
      const newEvent = await apiService.createEvent({
        title: title.trim(),
        side_a: sideA.trim(),
        side_b: sideB.trim(),
        end_time: parsedTime,
        group_id: groupId,
      });

      success();
      Alert.alert('Success', 'Event created!', [
        {
          text: 'View Event',
          onPress: () =>
            navigation.navigate('EventDetail' as never, { eventId: newEvent.id } as never),
        },
        {
          text: 'Back to Group',
          onPress: () => navigation.goBack(),
        },
      ]);
    } catch (error: any) {
      hapticError();
      Alert.alert('Error', error.message || 'Failed to create event. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.heading}>Create Event</Text>
            <Text style={styles.subheading}>Set up a new prediction event</Text>
          </View>

          {/* Form Card */}
          <View style={styles.card}>
            {/* Title */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Event Title</Text>
              <TextInput
                style={styles.input}
                placeholder="Will it rain tomorrow?"
                placeholderTextColor={colors.textFaint}
                value={title}
                onChangeText={setTitle}
                autoCapitalize="sentences"
                returnKeyType="next"
              />
            </View>

            {/* Sides */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Sides</Text>
              <View style={styles.sidesContainer}>
                <View style={[styles.sideInputWrapper, styles.sideInputWrapperA]}>
                  <View style={[styles.sideIndicator, styles.sideIndicatorA]}>
                    <Text style={[styles.sideIndicatorText, styles.sideIndicatorTextA]}>A</Text>
                  </View>
                  <TextInput
                    style={styles.sideInput}
                    placeholder="e.g. Yes"
                    placeholderTextColor={colors.textFaint}
                    value={sideA}
                    onChangeText={setSideA}
                    autoCapitalize="sentences"
                    returnKeyType="next"
                  />
                </View>
                <View style={styles.vsContainer}>
                  <Text style={styles.vsText}>vs</Text>
                </View>
                <View style={[styles.sideInputWrapper, styles.sideInputWrapperB]}>
                  <View style={[styles.sideIndicator, styles.sideIndicatorB]}>
                    <Text style={[styles.sideIndicatorText, styles.sideIndicatorTextB]}>B</Text>
                  </View>
                  <TextInput
                    style={styles.sideInput}
                    placeholder="e.g. No"
                    placeholderTextColor={colors.textFaint}
                    value={sideB}
                    onChangeText={setSideB}
                    autoCapitalize="sentences"
                    returnKeyType="next"
                  />
                </View>
              </View>
            </View>

            {/* End Date/Time */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>When does this end?</Text>
              <View style={styles.dateTimeRow}>
                <View style={styles.dateTimeField}>
                  <Ionicons name="calendar-outline" size={18} color={colors.brand2} style={styles.dateIcon} />
                  <TextInput
                    style={styles.dateTimeInput}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textFaint}
                    value={endDate}
                    onChangeText={setEndDate}
                    keyboardType="numbers-and-punctuation"
                    returnKeyType="next"
                  />
                </View>
                <View style={styles.dateTimeField}>
                  <Ionicons name="time-outline" size={18} color={colors.brand2} style={styles.dateIcon} />
                  <TextInput
                    style={styles.dateTimeInput}
                    placeholder="HH:MM"
                    placeholderTextColor={colors.textFaint}
                    value={endTime}
                    onChangeText={setEndTime}
                    keyboardType="numbers-and-punctuation"
                    returnKeyType="done"
                  />
                </View>
              </View>
              <Text style={styles.hint}>Use 24-hour format (e.g. 14:30)</Text>
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              onPress={handleCreate}
              disabled={isSubmitting}
              activeOpacity={0.85}
              style={isSubmitting && styles.submitButtonDisabled}
            >
              <LinearGradient
                colors={gradients.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.submitButton}
              >
                {isSubmitting ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <>
                    <Ionicons name="add-circle-outline" size={20} color={colors.white} />
                    <Text style={styles.submitButtonText}>Create Event</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 24,
  },
  heading: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  subheading: {
    fontSize: 15,
    color: colors.textMuted,
    fontWeight: '400',
  },
  card: {
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: 24,
  },
  fieldGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  input: {
    ...inputStyle,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sidesContainer: {
    gap: 12,
  },
  sideInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  sideInputWrapperA: {
    borderColor: colors.mint,
  },
  sideInputWrapperB: {
    borderColor: colors.rose,
  },
  sideIndicator: {
    width: 40,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
  },
  sideIndicatorA: {
    backgroundColor: colors.mintFill,
  },
  sideIndicatorB: {
    backgroundColor: colors.roseFill,
  },
  sideIndicatorText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  sideIndicatorTextA: {
    color: colors.mint,
  },
  sideIndicatorTextB: {
    color: colors.rose,
  },
  sideInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
  },
  vsContainer: {
    alignItems: 'center',
  },
  vsText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textFaint,
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateTimeField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  dateIcon: {
    marginLeft: 14,
  },
  dateTimeInput: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
  },
  hint: {
    fontSize: 12,
    color: colors.textFaint,
    marginTop: 6,
  },
  submitButton: {
    borderRadius: radius.pill,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...glow(colors.brand2),
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '700',
  },
});
