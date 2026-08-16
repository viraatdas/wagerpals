import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function migrateWallet() {
  console.log('Creating wallet tables...');

  await sql`
    CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance DECIMAL(10,2) DEFAULT 0 CHECK (balance >= 0),
      currency TEXT DEFAULT 'usd',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      stripe_payment_intent_id TEXT,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_transactions_stripe_id ON transactions(stripe_payment_intent_id)`;

  console.log('Wallet tables created successfully!');

  // Create wallets for all existing users
  const users = await sql`SELECT id FROM users`;
  for (const user of users.rows) {
    await sql`
      INSERT INTO wallets (user_id, balance, currency)
      VALUES (${user.id}, 0, 'usd')
      ON CONFLICT (user_id) DO NOTHING
    `;
  }

  console.log(`Created wallets for ${users.rows.length} existing users.`);
}

migrateWallet()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
