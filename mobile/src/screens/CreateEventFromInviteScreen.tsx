import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { colors, gradients, radius, glow } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { Group } from '../types';
import { tapLight, tapMedium, selectionTick, success, error as hapticError } from '../utils/haptics';

type InviteRouteProps = RouteProp<RootStackParamList, 'CreateEventFromInvite'>;

export default function CreateEventFromInviteScreen() {
  const route = useRoute<InviteRouteProps>();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { title, sideA, sideB, pick, amount } = route.params;

  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (user) {
      loadGroups();
    }
  }, [user]);

  const loadGroups = async () => {
    if (!user) return;
    try {
      const data = await apiService.getGroups(user.id);
      setGroups(data);
      if (data.length === 1) {
        setSelectedGroup(data[0]);
      }
    } catch (error) {
      console.error('Failed to load groups:', error);
    } finally {
      setIsLoadingGroups(false);
    }
  };

  const handleCreate = async () => {
    if (!user) {
      Alert.alert('Error', 'You must be logged in to create an event.');
      return;
    }

    if (!selectedGroup) {
      Alert.alert('Select Group', 'Please choose a group for this wager.');
      return;
    }

    if (!endDate.trim() || !endTime.trim()) {
      Alert.alert('Missing Field', 'Please enter an end date and time.');
      return;
    }

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
    setIsCreating(true);

    try {
      const newEvent = await apiService.createEvent({
        title,
        side_a: sideA,
        side_b: sideB,
        end_time: parsedTime,
        group_id: selectedGroup.id,
      });

      const parsedAmount = amount ? parseFloat(amount) : NaN;
      if (pick && !isNaN(parsedAmount) && parsedAmount > 0) {
        await apiService.createBet({
          event_id: newEvent.id,
          user_id: user.id,
          username: user.displayName || user.email || 'User',
          side: pick,
          amount: parsedAmount,
          note: 'Placed from iMessage',
        });
      }

      success();
      Alert.alert('Wager Created!', `"${title}" has been created in ${selectedGroup.name}.${pick && amount ? ` Your $${amount} bet on ${pick} was placed.` : ''}`, [
        {
          text: 'View Event',
          onPress: () =>
            navigation.navigate('EventDetail' as never, { eventId: newEvent.id } as never),
        },
      ]);
    } catch (error: any) {
      hapticError();
      Alert.alert('Error', error.message || 'Failed to create event.');
    } finally {
      setIsCreating(false);
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
          <Text style={styles.heading}>Wager Invite</Text>
          <Text style={styles.subheading}>Someone challenged you!</Text>

          {/* Invite Preview Card */}
          <View style={styles.card}>
            <Text style={styles.eventTitle}>{title}</Text>
            <View style={styles.sidesRow}>
              <View style={styles.sideBox}>
                <Text style={styles.sideLabel}>Side A</Text>
                <Text style={[styles.sideValue, styles.sideValueA]}>{sideA}</Text>
              </View>
              <Text style={styles.vs}>vs</Text>
              <View style={styles.sideBox}>
                <Text style={styles.sideLabel}>Side B</Text>
                <Text style={[styles.sideValue, styles.sideValueB]}>{sideB}</Text>
              </View>
            </View>
            {pick && amount && (
              <View style={styles.suggestedBetBox}>
                <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.brand2} />
                <Text style={styles.suggestedBetText}>
                  iMessage bet: ${amount} on {pick}
                </Text>
              </View>
            )}
          </View>

          {/* Group Picker */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Select Group</Text>
            {isLoadingGroups ? (
              <ActivityIndicator color={colors.brand2} style={styles.groupLoader} />
            ) : groups.length === 0 ? (
              <View style={styles.noGroupsBox}>
                <Ionicons name="people-outline" size={24} color={colors.textFaint} />
                <Text style={styles.noGroupsText}>
                  You need to join or create a group first.
                </Text>
                <TouchableOpacity
                  style={styles.goHomeButton}
                  onPress={() => navigation.navigate('Main' as any)}
                >
                  <Text style={styles.goHomeButtonText}>Go to Home</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.groupPickerButton}
                onPress={() => { tapLight(); setShowGroupPicker(true); }}
                activeOpacity={0.7}
              >
                {selectedGroup ? (
                  <View style={styles.selectedGroupRow}>
                    <View style={styles.groupAvatar}>
                      <Text style={styles.groupAvatarText}>
                        {selectedGroup.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.selectedGroupInfo}>
                      <Text style={styles.selectedGroupName}>{selectedGroup.name}</Text>
                      <Text style={styles.selectedGroupMeta}>
                        {selectedGroup.member_count ?? 0} members
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.groupPickerPlaceholder}>Choose a group...</Text>
                )}
                <Ionicons name="chevron-down" size={20} color={colors.textFaint} />
              </TouchableOpacity>
            )}
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

          {/* Create Button */}
          <TouchableOpacity
            onPress={handleCreate}
            disabled={isCreating || !selectedGroup}
            activeOpacity={0.85}
            style={(isCreating || !selectedGroup) && styles.createButtonDisabled}
          >
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.createButton}
            >
              {isCreating ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <>
                  <Ionicons name="flash" size={20} color={colors.white} />
                  <Text style={styles.createButtonText}>Create Wager</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* Fallback: just open the app */}
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate('Main' as any)}
          >
            <Text style={styles.secondaryButtonText}>Skip and Open WagerPals</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Group Picker Modal */}
      <Modal
        visible={showGroupPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowGroupPicker(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Group</Text>
            <TouchableOpacity onPress={() => setShowGroupPicker(false)}>
              <Ionicons name="close-circle" size={28} color={colors.textFaint} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={groups}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.modalList}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.groupListItem,
                  selectedGroup?.id === item.id && styles.groupListItemSelected,
                ]}
                onPress={() => {
                  selectionTick();
                  setSelectedGroup(item);
                  setShowGroupPicker(false);
                }}
                activeOpacity={0.7}
              >
                <View style={[
                  styles.groupAvatar,
                  selectedGroup?.id === item.id && styles.groupAvatarSelected,
                ]}>
                  <Text style={styles.groupAvatarText}>
                    {item.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.groupListInfo}>
                  <Text style={styles.groupListName}>{item.name}</Text>
                  <Text style={styles.groupListMeta}>
                    {item.member_count ?? 0} members
                  </Text>
                </View>
                {selectedGroup?.id === item.id && (
                  <Ionicons name="checkmark-circle" size={24} color={colors.brand2} />
                )}
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>
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
    padding: 24,
    paddingBottom: 40,
  },
  heading: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  subheading: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 24,
  },

  // Invite Preview Card
  card: {
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: 24,
    marginBottom: 24,
  },
  eventTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 20,
  },
  sidesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideBox: {
    flex: 1,
    alignItems: 'center',
  },
  sideLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textFaint,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  sideValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  sideValueA: {
    color: colors.mint,
  },
  sideValueB: {
    color: colors.rose,
  },
  vs: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textFaint,
    marginHorizontal: 12,
  },
  suggestedBetBox: {
    marginTop: 18,
    backgroundColor: colors.brandFill,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  suggestedBetText: {
    color: colors.brand2,
    fontSize: 13,
    fontWeight: '600',
  },

  // Fields
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
  groupLoader: {
    marginTop: 12,
  },
  noGroupsBox: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  noGroupsText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  goHomeButton: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.brandFill,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
  },
  goHomeButtonText: {
    color: colors.brand2,
    fontWeight: '600',
    fontSize: 14,
  },
  groupPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  groupPickerPlaceholder: {
    fontSize: 15,
    color: colors.textFaint,
  },
  selectedGroupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  groupAvatar: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brandFill,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupAvatarSelected: {
    backgroundColor: colors.brandFill,
    borderColor: colors.brand2,
  },
  groupAvatarText: {
    color: colors.brand2,
    fontSize: 16,
    fontWeight: '700',
  },
  selectedGroupInfo: {
    gap: 2,
  },
  selectedGroupName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  selectedGroupMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },

  // Date/Time
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

  // Buttons
  createButton: {
    borderRadius: radius.pill,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
    ...glow(colors.brand2),
  },
  createButtonDisabled: {
    opacity: 0.5,
  },
  createButtonText: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '500',
  },

  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  modalList: {
    padding: 16,
  },
  groupListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  groupListItemSelected: {
    borderColor: colors.brand2,
    backgroundColor: colors.brandFill,
  },
  groupListInfo: {
    flex: 1,
    gap: 2,
  },
  groupListName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  groupListMeta: {
    fontSize: 13,
    color: colors.textMuted,
  },
});
