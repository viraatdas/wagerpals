// API service layer for backend communication
import { User, Group, Event, Bet, Comment, ActivityItem, GroupMember, EventWithStats, Wallet } from '../types';
import authService from './auth';

// Use the backend API URL - can be configured via environment
// @ts-ignore
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || (__DEV__ 
  ? 'http://localhost:3000' 
  : 'https://wagerpals.io');

class ApiService {
  public API_BASE_URL = API_BASE_URL;
  
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    
    // Get access token and user ID for authenticated requests
    const token = await authService.getAccessToken();
    const currentUser = authService.getCurrentUser();

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          ...(currentUser?.id ? { 'x-stack-user-id': currentUser.id } : {}),
          ...options.headers,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'API request failed');
      }

      return await response.json();
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // User APIs
  async createOrUpdateUser(id: string, username: string): Promise<User> {
    return this.request<User>('/api/users', {
      method: 'POST',
      body: JSON.stringify({ id, username }),
    });
  }

  async getUser(id: string): Promise<User> {
    return this.request<User>(`/api/users?id=${id}`);
  }

  async getUserByUsername(username: string): Promise<User> {
    return this.request<User>(`/api/users?username=${username}`);
  }

  async getAllUsers(): Promise<User[]> {
    return this.request<User[]>('/api/users');
  }

  // Group APIs
  async getGroups(userId: string): Promise<Group[]> {
    return this.request<Group[]>(`/api/groups?userId=${userId}`);
  }

  async getGroup(groupId: string): Promise<Group & { members?: GroupMember[]; pending_requests?: GroupMember[] }> {
    return this.request<Group & { members?: GroupMember[]; pending_requests?: GroupMember[] }>(`/api/groups?id=${groupId}`);
  }

  async createGroup(name: string, createdBy: string): Promise<Group> {
    return this.request<Group>('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name, created_by: createdBy }),
    });
  }

  async joinGroup(groupId: string, userId: string): Promise<{ message: string }> {
    return this.request(`/api/groups/join`, {
      method: 'POST',
      body: JSON.stringify({ group_id: groupId, user_id: userId }),
    });
  }

  async getGroupMembers(groupId: string): Promise<GroupMember[]> {
    return this.request<GroupMember[]>(`/api/groups/members?groupId=${groupId}`);
  }

  async manageGroupMember(
    action: 'approve' | 'decline' | 'promote' | 'demote' | 'remove',
    groupId: string,
    adminUserId: string,
    targetUserId: string
  ): Promise<{ message: string }> {
    return this.request('/api/groups/members', {
      method: 'POST',
      body: JSON.stringify({
        action,
        group_id: groupId,
        admin_user_id: adminUserId,
        target_user_id: targetUserId,
      }),
    });
  }

  async updateGroupSettings(input: {
    id: string;
    resolver_user_id?: string;
    is_public?: boolean;
  }): Promise<Group> {
    return this.request<Group>('/api/groups', {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  async deleteGroup(groupId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/groups?id=${groupId}`, {
      method: 'DELETE',
    });
  }

  async getWallet(userId: string): Promise<{ wallet: Wallet; transactions: any[] }> {
    return this.request<{ wallet: Wallet; transactions: any[] }>(`/api/wallet?userId=${userId}`);
  }

  // Event APIs
  async getEvents(groupId?: string): Promise<Event[]> {
    const query = groupId ? `?groupId=${groupId}` : '';
    return this.request<Event[]>(`/api/events${query}`);
  }

  async getEvent(id: string): Promise<EventWithStats> {
    return this.request<EventWithStats>(`/api/events?id=${id}`);
  }

  async createEvent(event: {
    title: string;
    description?: string;
    side_a: string;
    side_b: string;
    end_time: number;
    group_id: string;
  }): Promise<Event> {
    return this.request<Event>('/api/events', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  }

  async resolveEvent(
    id: string,
    winningSide: string
  ): Promise<{ message: string }> {
    return this.request(`/api/events/resolve`, {
      method: 'POST',
      body: JSON.stringify({ id, winning_side: winningSide }),
    });
  }

  async unresolveEvent(id: string): Promise<{ message: string }> {
    return this.request(`/api/events/unresolve`, {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  }

  async deleteEvent(id: string): Promise<{ message: string }> {
    return this.request(`/api/events/delete`, {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  }

  // Bet APIs
  async createBet(bet: {
    event_id: string;
    user_id: string;
    username: string;
    side: string;
    amount: number;
    note?: string;
  }): Promise<Bet> {
    return this.request<Bet>('/api/bets', {
      method: 'POST',
      body: JSON.stringify(bet),
    });
  }

  // Comment APIs
  async getComments(eventId: string): Promise<Comment[]> {
    return this.request<Comment[]>(`/api/comments?eventId=${eventId}`);
  }

  async createComment(comment: {
    event_id: string;
    user_id: string;
    username: string;
    content: string;
  }): Promise<Comment> {
    return this.request<Comment>('/api/comments', {
      method: 'POST',
      body: JSON.stringify(comment),
    });
  }

  // Activity APIs
  async getActivity(groupId?: string): Promise<ActivityItem[]> {
    const query = groupId ? `?groupId=${groupId}` : '';
    return this.request<ActivityItem[]>(`/api/activity${query}`);
  }

  // Push notification APIs
  async sendPushToUser(input: {
    userId: string;
    title?: string;
    body?: string;
    url?: string;
    eventId?: string;
    tag?: string;
  }): Promise<{ ok: boolean } | any> {
    return this.request('/api/push/send-to-user', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  async subscribeToPush(subscription: {
    token: string;
    userId?: string;
  }): Promise<{ success: boolean }> {
    return this.request('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    });
  }

  async unsubscribeFromPush(token: string): Promise<{ success: boolean }> {
    return this.request('/api/push/subscribe', {
      method: 'DELETE',
      body: JSON.stringify({ token }),
    });
  }
}

export default new ApiService();
