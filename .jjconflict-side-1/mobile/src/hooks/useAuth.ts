// Custom hook for using current auth user
import { useState, useEffect } from 'react';
import authService from '../services/auth';
import { AuthUser } from '../types';

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = authService.onAuthStateChanged((newUser) => {
      setUser(newUser);
      setIsLoading(false);
    });

    return unsubscribe;
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    signOut: () => authService.signOut(),
  };
}





