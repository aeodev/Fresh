# FreshQA sidebar app for Freshchat

A private Freshchat app (Freshworks platform 3.1) that lives in the Team Inbox conversation pane.

What it does:

- Shows whether the FreshQA agent or a person owns the open conversation, and the agent's last decision.
- **Take over** stops the agent for that chat. **Hand back** lets the agent continue. **Reply now** asks the agent to look at the chat immediately.
- Forwards Freshchat product events (`onMessageCreate`, `onConversationCreate`, `onConversationUpdate`) to FreshQA, so you do **not** need the account-level webhook.

## Pack and install

Requires Node 24.11 and FDK 10.1.9 (`npm install -g https://cdn.freshdev.io/fdk/v10.1.9.tgz`).

```bash
cd sidebar-app
fdk validate
fdk pack --skip-coverage        # writes dist/freshqa-sidebar.zip
```

In Freshchat: **Admin Settings → Marketplace Apps → Manage Apps → Custom Apps → Go to Developer Portal → Custom App → Create New App**, upload the ZIP, then **Install** it. The install form asks for:

- **FreshQA address**: the host of your FreshQA deployment without `https://` (for local testing, your tunnel host such as `abc.trycloudflare.com`).
- **FreshQA Companion token**: issue one in FreshQA → *Settings → Freshchat sidebar → Issue token*.

Open any Team Inbox conversation and expand **FreshQA** in the right pane.

Do not upload the raw source folder: `{{{appclient}}}` in `app/index.html` is only rewritten by `fdk pack`.
