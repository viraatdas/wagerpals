import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { colors, gradients, radius, glow, inputStyle } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { EventWithStats, Bet, Comment, Wallet } from '../types';
import { formatCurrency } from '../utils/helpers';
import { tapLight, tapMedium, selectionTick, success, error as hapticError } from '../utils/haptics';

type EventDetailRouteProps = RouteProp<RootStackParamList, 'EventDetail'>;

function useCountdown(endTime: number) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (endTime <= Date.now()) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  const diff = Math.max(0, endTime - now);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  if (diff <= 0) return 'Ended';
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export default function EventDetailScreen() {
  const route = useRoute<EventDetailRouteProps>();
  const { user } = useAuth();
  const { eventId } = route.params;

  const [event, setEvent] = useState<EventWithStats | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Bet form state
  const [selectedSide, setSelectedSide] = useState<string | null>(null);
  const [betAmount, setBetAmount] = useState('');
  const [betNote, setBetNote] = useState('');
  const [isPlacingBet, setIsPlacingBet] = useState(false);

  // Comment form state
  const [commentText, setCommentText] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);

  const countdown = useCountdown(event?.end_time ?? 0);

  useFocusEffect(
    useCallback(() => {
      loadEventData();
    }, [eventId])
  );

  const loadEventData = async () => {
    try {
      const [eventData, commentsData] = await Promise.all([
        apiService.getEvent(eventId),
        apiService.getComments(eventId),
      ]);
      setEvent(eventData);
      setComments(Array.isArray(commentsData) ? commentsData : []);
      if (user && !eventData.is_public) {
        apiService.getWallet(user.id)
          .then((data) => setWallet(data.wallet))
          .catch((error) => console.error('Failed to load wallet:', error));
      }
    } catch (error) {
      console.error('Failed to load event:', error);
      Alert.alert('Error', 'Failed to load event data.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleDeposit = () => {
    Linking.openURL('https://wagerpals.io/profile?wallet=deposit');
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadEventData();
  };

  const handlePlaceBet = async () => {
    if (!user || !event) return;

    if (!selectedSide) {
      hapticError();
      Alert.alert('Select a Side', 'Please pick a side before placing your bet.');
      return;
    }

    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) {
      hapticError();
      Alert.alert('Invalid Amount', 'Please enter a valid bet amount.');
      return;
    }

    tapMedium();
    setIsPlacingBet(true);

    try {
      await apiService.createBet({
        event_id: eventId,
        user_id: user.id,
        username: user.displayName || user.email || 'User',
        side: selectedSide,
        amount,
        note: betNote.trim() || undefined,
      });

      success();
      setBetAmount('');
      setBetNote('');
      setSelectedSide(null);
      Alert.alert('Bet Placed', `You bet ${formatCurrency(amount)} on "${selectedSide}"`);
      loadEventData();
    } catch (error: any) {
      hapticError();
      Alert.alert('Error', error.message || 'Failed to place bet.');
    } finally {
      setIsPlacingBet(false);
    }
  };

  const handlePostComment = async () => {
    if (!user || !event) return;
    if (!commentText.trim()) return;

    tapLight();
    setIsPostingComment(true);

    try {
      await apiService.createComment({
        event_id: eventId,
        user_id: user.id,
        username: user.displayName || user.email || 'User',
        content: commentText.trim(),
      });

      success();
      setCommentText('');
      loadEventData();
    } catch (error: any) {
      hapticError();
      Alert.alert('Error', error.message || 'Failed to post comment.');
    } finally {
      setIsPostingComment(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.brand2} />
        <Text style={styles.loadingText}>Loading event...</Text>
      </View>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.loadingContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textFaint} />
          <Text style={styles.emptyText}>Event not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isActive = event.status === 'active';
  const isEnded = event.end_time < Date.now();
  const isResolved = event.status === 'resolved';
  const canBet = isActive && !isEnded;
  const isPaid = event.is_public === false;
  const resolver = event.resolver;

  // Merge bets and comments into a single timeline
  const ledgerItems: Array<
    | { type: 'bet'; data: Bet; timestamp: number }
    | { type: 'comment'; data: Comment; timestamp: number }
  > = [
    ...event.bets.map((b) => ({ type: 'bet' as const, data: b, timestamp: b.timestamp })),
    ...comments.map((c) => ({ type: 'comment' as const, data: c, timestamp: c.timestamp })),
  ].sort((a, b) => b.timestamp - a.timestamp);

  const sideAStats = event.side_stats?.[event.side_a] ?? { count: 0, total: 0 };
  const sideBStats = event.side_stats?.[event.side_b] ?? { count: 0, total: 0 };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.brand2} />
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Resolution Banner */}
          {isResolved && event.resolution && (
            <LinearGradient
              colors={gradients.mint}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.resolutionBanner}
            >
              <Ionicons name="trophy" size={20} color={colors.white} />
              <Text style={styles.resolutionText}>
                Resolved: {event.resolution.winning_side} wins!
              </Text>
            </LinearGradient>
          )}

          {/* Title & Status */}
          <View style={styles.headerSection}>
            <Text style={styles.eventTitle}>{event.title}</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, isActive && !isEnded ? styles.activeBadge : styles.endedBadge]}>
                <Text style={[styles.badgeText, isActive && !isEnded ? styles.activeBadgeText : styles.endedBadgeText]}>
                  {isResolved ? 'Resolved' : isEnded ? 'Ended' : 'Active'}
                </Text>
              </View>
              {!isEnded && isActive && (
                <View style={styles.countdownContainer}>
                  <Ionicons name="time-outline" size={14} color={colors.brand2} />
                  <Text style={styles.countdownText}>{countdown}</Text>
                </View>
              )}
            </View>
          </View>

          {isPaid && (
            <View style={styles.paidInfoCard}>
              <View style={styles.paidInfoRow}>
                <View>
                  <Text style={styles.paidInfoLabel}>Wallet balance</Text>
                  <Text style={styles.paidInfoBalance}>{formatCurrency(wallet?.balance || 0)}</Text>
                </View>
                <TouchableOpacity onPress={handleDeposit} activeOpacity={0.85}>
                  <LinearGradient
                    colors={gradients.brand}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.depositButton}
                  >
                    <Ionicons name="card-outline" size={16} color={colors.white} />
                    <Text style={styles.depositButtonText}>Deposit</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
              <Text style={styles.resolverText}>
                Resolver: @{resolver?.username || 'Not set'}
              </Text>
            </View>
          )}

          {/* Side Stats */}
          <View style={styles.sidesRow}>
            <View style={[
              styles.sideCard,
              styles.sideCardA,
              isResolved && event.resolution?.winning_side === event.side_a && styles.winningSideCard,
            ]}>
              <Text style={styles.sideName}>{event.side_a}</Text>
              <Text style={[styles.sideTotal, styles.sideTotalA]}>{formatCurrency(sideAStats.total)}</Text>
              <Text style={styles.sideCount}>{sideAStats.count} bet{sideAStats.count !== 1 ? 's' : ''}</Text>
              {isResolved && event.resolution?.winning_side === event.side_a && (
                <View style={styles.winnerTag}>
                  <Ionicons name="trophy" size={12} color={colors.mint} />
                  <Text style={styles.winnerTagText}>Winner</Text>
                </View>
              )}
            </View>
            <Text style={styles.vsCenter}>vs</Text>
            <View style={[
              styles.sideCard,
              styles.sideCardB,
              isResolved && event.resolution?.winning_side === event.side_b && styles.winningSideCard,
            ]}>
              <Text style={styles.sideName}>{event.side_b}</Text>
              <Text style={[styles.sideTotal, styles.sideTotalB]}>{formatCurrency(sideBStats.total)}</Text>
              <Text style={styles.sideCount}>{sideBStats.count} bet{sideBStats.count !== 1 ? 's' : ''}</Text>
              {isResolved && event.resolution?.winning_side === event.side_b && (
                <View style={styles.winnerTag}>
                  <Ionicons name="trophy" size={12} color={colors.mint} />
                  <Text style={styles.winnerTagText}>Winner</Text>
                </View>
              )}
            </View>
          </View>

          {/* Bet Form */}
          {canBet && (
            <View style={styles.betFormCard}>
              <Text style={styles.sectionTitle}>Place Your Bet</Text>

              {/* Side Selector */}
              <View style={styles.sideSelector}>
                <TouchableOpacity
                  style={[styles.sideButton, selectedSide === event.side_a && styles.sideButtonSelectedA]}
                  onPress={() => { selectionTick(); setSelectedSide(event.side_a); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.sideButtonText, selectedSide === event.side_a && styles.sideButtonTextSelectedA]}>
                    {event.side_a}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sideButton, selectedSide === event.side_b && styles.sideButtonSelectedB]}
                  onPress={() => { selectionTick(); setSelectedSide(event.side_b); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.sideButtonText, selectedSide === event.side_b && styles.sideButtonTextSelectedB]}>
                    {event.side_b}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Amount */}
              <View style={styles.amountRow}>
                <Text style={styles.dollarSign}>$</Text>
                <TextInput
                  style={styles.amountInput}
                  placeholder="0.00"
                  placeholderTextColor={colors.textFaint}
                  value={betAmount}
                  onChangeText={setBetAmount}
                  keyboardType="decimal-pad"
                  returnKeyType="next"
                />
              </View>

              {/* Note */}
              <TextInput
                style={styles.noteInput}
                placeholder="Add a note (optional)"
                placeholderTextColor={colors.textFaint}
                value={betNote}
                onChangeText={setBetNote}
                returnKeyType="done"
              />

              {/* Submit */}
              <TouchableOpacity
                onPress={handlePlaceBet}
                disabled={isPlacingBet}
                activeOpacity={0.85}
                style={isPlacingBet && styles.buttonDisabled}
              >
                <LinearGradient
                  colors={gradients.brand}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.placeBetButton}
                >
                  {isPlacingBet ? (
                    <ActivityIndicator color={colors.white} size="small" />
                  ) : (
                    <Text style={styles.placeBetButtonText}>Place Bet</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
              {isPaid && (
                <Text style={styles.walletHint}>
                  Paid bets are deducted from your wallet when placed.
                </Text>
              )}
            </View>
          )}

          {/* Comment Form */}
          {isActive && (
            <View style={styles.commentFormCard}>
              <Text style={styles.sectionTitle}>Add a Comment</Text>
              <View style={styles.commentInputRow}>
                <TextInput
                  style={styles.commentInput}
                  placeholder="Say something..."
                  placeholderTextColor={colors.textFaint}
                  value={commentText}
                  onChangeText={setCommentText}
                  multiline
                  returnKeyType="default"
                />
                <TouchableOpacity
                  onPress={handlePostComment}
                  disabled={isPostingComment || !commentText.trim()}
                  activeOpacity={0.7}
                  style={isPostingComment && styles.buttonDisabled}
                >
                  <LinearGradient
                    colors={gradients.brand}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.commentSendButton}
                  >
                    {isPostingComment ? (
                      <ActivityIndicator color={colors.white} size="small" />
                    ) : (
                      <Ionicons name="send" size={18} color={colors.white} />
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Ledger */}
          <View style={styles.ledgerSection}>
            <Text style={styles.ledgerTitle}>Ledger</Text>

            {ledgerItems.length === 0 ? (
              <View style={styles.emptyLedger}>
                <Ionicons name="document-text-outline" size={36} color={colors.textFaint} />
                <Text style={styles.emptyLedgerText}>No activity yet</Text>
              </View>
            ) : (
              ledgerItems.map((item) => {
                if (item.type === 'bet') {
                  const bet = item.data;
                  return (
                    <View key={`bet-${bet.id}`} style={styles.ledgerItem}>
                      <View style={[styles.ledgerIcon, styles.ledgerIconBet]}>
                        <Ionicons name="cash-outline" size={16} color={colors.brand2} />
                      </View>
                      <View style={styles.ledgerContent}>
                        <Text style={styles.ledgerMainText}>
                          <Text style={styles.boldText}>{bet.username}</Text> bet{' '}
                          <Text style={styles.boldText}>{formatCurrency(bet.amount)}</Text> on{' '}
                          <Text style={styles.orangeText}>{bet.side}</Text>
                        </Text>
                        {bet.note ? <Text style={styles.ledgerNote}>{bet.note}</Text> : null}
                        {bet.is_late && (
                          <View style={styles.lateBadge}>
                            <Text style={styles.lateBadgeText}>Late bet</Text>
                          </View>
                        )}
                        <Text style={styles.ledgerTime}>
                          {new Date(bet.timestamp).toLocaleDateString()}{' '}
                          {new Date(bet.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                    </View>
                  );
                } else {
                  const comment = item.data;
                  return (
                    <View key={`comment-${comment.id}`} style={styles.ledgerItem}>
                      <View style={[styles.ledgerIcon, styles.ledgerIconComment]}>
                        <Ionicons name="chatbubble-outline" size={16} color={colors.violet} />
                      </View>
                      <View style={styles.ledgerContent}>
                        <Text style={styles.ledgerMainText}>
                          <Text style={styles.boldText}>{comment.username}</Text>
                        </Text>
                        <Text style={styles.commentContent}>{comment.content}</Text>
                        <Text style={styles.ledgerTime}>
                          {new Date(comment.timestamp).toLocaleDateString()}{' '}
                          {new Date(comment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                    </View>
                  );
                }
              })
            )}
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
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textMuted,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 18,
    color: colors.textMuted,
    fontWeight: '500',
  },

  // Resolution Banner
  resolutionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  resolutionText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },

  // Header
  headerSection: {
    padding: 20,
    paddingBottom: 12,
  },
  eventTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  activeBadge: {
    backgroundColor: colors.mintFill,
    borderColor: colors.mint,
  },
  endedBadge: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  activeBadgeText: {
    color: colors.mint,
  },
  endedBadgeText: {
    color: colors.textMuted,
  },
  countdownContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.brandFill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  countdownText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.brand2,
  },
  paidInfoCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    backgroundColor: colors.surfaceGlass,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  paidInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  paidInfoLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 3,
  },
  paidInfoBalance: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  depositButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.pill,
    ...glow(colors.brand2),
  },
  depositButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
  resolverText: {
    marginTop: 10,
    color: colors.textMuted,
    fontSize: 13,
  },

  // Sides
  sidesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 8,
  },
  sideCard: {
    flex: 1,
    backgroundColor: colors.surfaceGlass,
    borderRadius: radius.lg,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  sideCardA: {
    backgroundColor: colors.mintFill,
    borderColor: colors.border,
  },
  sideCardB: {
    backgroundColor: colors.roseFill,
    borderColor: colors.border,
  },
  winningSideCard: {
    borderColor: colors.mint,
    ...glow(colors.mint),
  },
  sideName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  sideTotal: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  sideTotalA: {
    color: colors.mint,
  },
  sideTotalB: {
    color: colors.rose,
  },
  sideCount: {
    fontSize: 12,
    color: colors.textMuted,
  },
  winnerTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    backgroundColor: colors.mintFill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  winnerTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.mint,
  },
  vsCenter: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textFaint,
  },

  // Bet Form
  betFormCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 14,
  },
  sideSelector: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  sideButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
    alignItems: 'center',
  },
  sideButtonSelectedA: {
    borderColor: colors.mint,
    backgroundColor: colors.mintFill,
    ...glow(colors.mint),
  },
  sideButtonSelectedB: {
    borderColor: colors.rose,
    backgroundColor: colors.roseFill,
    ...glow(colors.rose),
  },
  sideButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textMuted,
  },
  sideButtonTextSelectedA: {
    color: colors.mint,
  },
  sideButtonTextSelectedB: {
    color: colors.rose,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    marginBottom: 10,
    paddingHorizontal: 14,
  },
  dollarSign: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textMuted,
    marginRight: 4,
  },
  amountInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 18,
    color: colors.text,
  },
  noteInput: {
    ...inputStyle,
    fontSize: 15,
    marginBottom: 14,
  },
  placeBetButton: {
    borderRadius: radius.pill,
    paddingVertical: 16,
    alignItems: 'center',
    ...glow(colors.brand2),
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  placeBetButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  walletHint: {
    marginTop: 10,
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },

  // Comment Form
  commentFormCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: 20,
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  commentInput: {
    ...inputStyle,
    flex: 1,
    fontSize: 15,
    maxHeight: 100,
  },
  commentSendButton: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...glow(colors.brand2),
  },

  // Ledger
  ledgerSection: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  ledgerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: colors.brand2,
    paddingBottom: 6,
    alignSelf: 'flex-start',
  },
  emptyLedger: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyLedgerText: {
    marginTop: 8,
    fontSize: 15,
    color: colors.textFaint,
  },
  ledgerItem: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 12,
  },
  ledgerIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  ledgerIconBet: {
    backgroundColor: colors.brandFill,
  },
  ledgerIconComment: {
    backgroundColor: colors.cyanFill,
  },
  ledgerContent: {
    flex: 1,
  },
  ledgerMainText: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
  boldText: {
    fontWeight: '700',
    color: colors.text,
  },
  orangeText: {
    fontWeight: '700',
    color: colors.brand2,
  },
  ledgerNote: {
    fontSize: 13,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: 2,
  },
  lateBadge: {
    backgroundColor: colors.roseFill,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  lateBadgeText: {
    fontSize: 11,
    color: colors.rose,
    fontWeight: '600',
  },
  commentContent: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 20,
  },
  ledgerTime: {
    fontSize: 11,
    color: colors.textFaint,
    marginTop: 4,
  },
});
