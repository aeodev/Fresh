# FreshQA sidebar app for Freshchat

A private Freshchat app (Freshworks platform 3.1) that lives in the Team Inbox conversation pane.

What it does:

- Shows one on/off control for the open conversation, plus the latest agent decision.
- Turning on reads the Freshchat history and checks for an unanswered customer message. Turning off hands the chat to a person.
- A customer's request not to reply keeps the agent quiet for that message; a later message can be answered.
- Forwards Freshchat product events (`onMessageCreate`, `onConversationCreate`, `onConversationUpdate`) to FreshQA, so you do **not** need the account-level webhook.

## Pack and install

Requires Node 24.11. FDK 10.1.9 is pinned in this app's package lock.

```bash
npm ci --prefix sidebar-app
npm run pack:sidebar
```

This validates and packs the app, then copies a versioned ZIP and `public/downloads/freshqa-sidebar-latest.zip`. The FreshQA dashboard serves the latest file from **Settings → Sidebar app → Download Freshchat app ZIP**. Regenerate it after changing the sidebar code or version.

In Freshchat: **Admin Settings → Marketplace Apps → Manage Apps → Custom Apps → Go to Developer Portal → Custom App → Create New App**, upload the ZIP, then **Install** it. The install form asks for:

- **FreshQA address**: the host of your FreshQA deployment without `https://` (for local testing, your tunnel host such as `abc.trycloudflare.com`).
- **FreshQA Companion token**: issue one in FreshQA → *Settings → Freshchat sidebar → Issue token*.

Open any Team Inbox conversation and expand **FreshQA** in the right pane.

Do not upload the raw source folder: `{{{appclient}}}` in `app/index.html` is only rewritten by `fdk pack`.
