-- Migration script to update schema for mobile app support
-- Run this after deploying the mobile app

BEGIN;

-- Add username_selected field to track if user has chosen their username
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_selected BOOLEAN DEFAULT FALSE;

-- Update existing users to have username_selected = true
UPDATE users SET username_selected = TRUE WHERE username_selected IS NULL;

-- Update push_subscriptions table to support both web push and Expo push
ALTER TABLE push_subscriptions ALTER COLUMN p256dh DROP NOT NULL;
ALTER TABLE push_subscriptions ALTER COLUMN auth DROP NOT NULL;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS expo_token TEXT;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'web';

-- Update existing push subscriptions to be marked as 'web'
UPDATE push_subscriptions SET platform = 'web' WHERE platform IS NULL;

COMMIT;





