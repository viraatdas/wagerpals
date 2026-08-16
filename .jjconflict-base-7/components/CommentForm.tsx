'use client';

import { useState } from 'react';

interface CommentFormProps {
  eventId: string;
  userId: string;
  username: string;
  onCommentPosted: () => void;
}

export default function CommentForm({ eventId, userId, username, onCommentPosted }: CommentFormProps) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    setLoading(true);

    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-stack-user-id': userId },
        body: JSON.stringify({
          event_id: eventId,
          user_id: userId,
          username,
          content: content.trim(),
        }),
      });

      if (response.ok) {
        setContent('');
        onCommentPosted();
      }
    } catch (error) {
      console.error('Failed to post comment:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="glass rounded-2xl p-4">
      <div className="mb-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          className="w-full bg-white border border-gray-300 text-foreground placeholder:text-muted-2 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:border-brand-2 focus:ring-2 focus:ring-brand-2/20 transition"
          placeholder="Add a comment..."
          required
        />
      </div>
      <button
        type="submit"
        disabled={loading || !content.trim()}
        className="btn-primary text-sm px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
      >
        {loading ? 'Posting...' : 'Post Comment'}
      </button>
    </form>
  );
}

