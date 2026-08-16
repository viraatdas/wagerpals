// Join Group screen
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { colors, gradients, radius, glow, inputStyle } from '../theme';

export default function JoinGroupScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { user } = useAuth();
  const [groupCode, setGroupCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Check if group ID was passed via deep link
    const params = route.params as { groupId?: string };
    if (params?.groupId) {
      setGroupCode(params.groupId);
    }
  }, [route.params]);

  const handleJoin = async () => {
    if (!groupCode || !user) return;

    setIsLoading(true);
    try {
      await apiService.joinGroup(groupCode, user.id);
      Alert.alert(
        'Success',
        'Join request submitted! You will be notified when an admin approves your request.',
        [
          {
            text: 'OK',
            onPress: () => navigation.navigate('Main' as never),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to join group');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.content}>
        <Text style={styles.title}>Join a Group</Text>
        <Text style={styles.subtitle}>
          Enter the 6-digit code shared by the group admin
        </Text>

        <TextInput
          style={styles.input}
          placeholder="000000"
          placeholderTextColor={colors.textFaint}
          value={groupCode}
          onChangeText={setGroupCode}
          maxLength={6}
          autoCapitalize="characters"
          autoFocus={!groupCode}
        />

        <TouchableOpacity
          style={[styles.buttonWrap, isLoading && styles.buttonDisabled]}
          onPress={handleJoin}
          disabled={isLoading || !groupCode}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={gradients.brand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.button}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Join Group</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <Text style={styles.note}>
          Note: Your request will be pending until an admin approves it
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '300',
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textMuted,
    marginBottom: 32,
  },
  input: {
    ...inputStyle,
    height: 60,
    fontSize: 24,
    textAlign: 'center',
    letterSpacing: 8,
    marginBottom: 24,
  },
  buttonWrap: {
    borderRadius: radius.pill,
    marginBottom: 16,
    ...glow(colors.brand2),
  },
  button: {
    height: 50,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  note: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});





