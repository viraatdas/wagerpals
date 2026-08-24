// The privacy policy App Review requires a real URL for (Guideline 5.1.1).
//
// CONTACT is the address Apple may test and that real deletion requests go to.
// It must be an inbox someone actually reads — it is already the TestFlight
// beta feedback address, so it is known-live. Change it in one place here.
// Until this existed, App Store Connect's privacyPolicyUrl pointed at the
// homepage, which says nothing about privacy — a rejection waiting to happen.
//
// Keep this factual. Every claim below is checked against what the code
// actually does; if a new field, vendor, or retention rule lands, change this
// page in the same commit.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy · Wager Pals',
  description:
    'What Wager Pals collects, why, who it is shared with, and how to delete it.',
};

// Last substantive change to this policy. Bump when the content changes.
const LAST_UPDATED = 'August 24, 2026';
const CONTACT = 'viraat.laldas@gmail.com';

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="display-3 mb-3">{title}</h2>
      <div className="space-y-3 text-ink-secondary">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="page-shell-narrow mobile-page animate-rise">
      <div className="mb-2">
        <p className="eyebrow mb-1">Legal</p>
        <h1 className="display-2">Privacy Policy</h1>
      </div>
      <p className="text-ink-muted">Last updated {LAST_UPDATED}</p>

      <p className="lede mt-6">
        Wager Pals lets you make friendly wagers with people you know. We collect
        what the app needs to do that and nothing we do not use. We do not sell
        your personal information, and we do not run advertising.
      </p>

      <Section title="What we collect">
        <p>
          <strong className="text-ink">Account information.</strong> When you sign
          in with Apple, sign in with Google, or use an email link, we receive an
          email address and, if you choose to share it, a name and profile photo.
          If you use Sign in with Apple&apos;s Hide My Email, we only ever see the
          private relay address, and that is the address we store.
        </p>
        <p>
          <strong className="text-ink">Profile.</strong> The username, display name
          and photo you set in the app.
        </p>
        <p>
          <strong className="text-ink">Your activity in the app.</strong> The
          groups you belong to, wagers you create or take a side on, amounts
          staked, comments and reactions you post, and the resulting record of who
          won and lost.
        </p>
        <p>
          <strong className="text-ink">Payment records.</strong> If you add money,
          card details go directly to our payment processor — they never reach our
          servers. We store the amount, currency, status and processor reference
          so balances and payouts are correct.
        </p>
        <p>
          <strong className="text-ink">Notification tokens.</strong> If you turn on
          notifications, the device or browser push token needed to deliver them.
        </p>
        <p>
          <strong className="text-ink">Basic technical logs.</strong> Standard
          server logs from our hosting provider, used to keep the service running
          and secure.
        </p>
      </Section>

      <Section title="What we do with it">
        <p>
          To run your account, show wagers and balances to the people entitled to
          see them, settle wagers, send the notifications you asked for, prevent
          abuse, and meet legal and accounting obligations. That is the whole
          list.
        </p>
        <p>
          We do not sell or rent personal information, we do not share it with
          advertisers, and we do not use it to build advertising profiles.
        </p>
      </Section>

      <Section title="Who else sees it">
        <p>
          <strong className="text-ink">Other people in the app.</strong> Members of
          a group can see that group&apos;s wagers, who took which side, the
          amounts, and comments. Your username, display name and photo are visible
          to people you share a group with. A wager can be created so that its
          subject cannot see it; that setting hides it from that person only, not
          from the rest of the group.
        </p>
        <p>
          <strong className="text-ink">Service providers</strong>, each handling
          only what their job requires: authentication, database hosting and
          application hosting, payment processing, and push notification
          delivery. They are bound by their own contracts and privacy terms.
        </p>
        <p>
          <strong className="text-ink">When the law requires it</strong>, or to
          protect the safety and rights of our users.
        </p>
      </Section>

      <Section title="Keeping it and deleting it">
        <p>
          We keep your information for as long as your account exists. Financial
          transaction records are kept longer where accounting or legal rules
          require it.
        </p>
        <p>
          You can ask us to delete your account and personal information at any
          time by emailing{' '}
          <a
            className="text-accent underline underline-offset-2"
            href={`mailto:${CONTACT}`}
          >
            {CONTACT}
          </a>{' '}
          from the address on your account. We will delete or anonymise it, other
          than records we must keep, and we will tell you what those are. You can
          also correct your profile details in the app at any time, and turn
          notifications off in the app or in your device settings.
        </p>
        <p>
          Depending on where you live you may have additional rights over your
          personal information, such as access, correction, deletion, or objecting
          to certain uses. Use the same address and we will honour them.
        </p>
      </Section>

      <Section title="Children">
        <p>
          Wager Pals is not directed to children, and we do not knowingly collect
          personal information from children. If you believe a child has given us
          personal information, contact us and we will remove it.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Data is encrypted in transit. Card details are handled entirely by our
          payment processor and never stored on our servers. Access to production
          data is limited to those who need it to operate the service. No service
          can promise perfect security, but we take this seriously.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If we change this policy we will update the date at the top of this
          page, and for significant changes we will tell you in the app.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about privacy, or a request about your data:{' '}
          <a
            className="text-accent underline underline-offset-2"
            href={`mailto:${CONTACT}`}
          >
            {CONTACT}
          </a>
          .
        </p>
      </Section>
    </div>
  );
}
