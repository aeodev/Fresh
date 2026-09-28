# Set up FreshQA v2 and test it in Freshchat

## 1. Run FreshQA

```bash
cd freshqa-v2
npm install
cp .dev.vars.example .dev.vars        # add OPENAI_API_KEY (required for answers and embeddings)
npm run db:migrate                     # creates the local D1 database
npm run build                          # builds the UI into dist/client
npx wrangler dev --port 8787           # http://localhost:8787
```

For UI work with hot reload use `npm run dev` (Vite on 5173 proxying /api to 8787).

Freshchat must reach your machine, so open a tunnel in another terminal:

```bash
cloudflared tunnel --url http://localhost:8787     # prints https://<random>.trycloudflare.com
# or: ngrok http 8787
```

Put that URL in `.dev.vars` as `PUBLIC_BASE_URL=https://<random>.trycloudflare.com` and restart `wrangler dev` so invite links and the setup screen show the public address.

Deploying for real: `wrangler login`, `wrangler d1 create freshqa` (paste the id into `wrangler.jsonc`), `npm run db:migrate:remote`, `wrangler secret put OPENAI_API_KEY` (and `ENCRYPTION_KEY`, `PUBLIC_BASE_URL`), then `npm run deploy`.

## 2. Create your account and company

Open FreshQA, **Create account**, then **Create company**. You are its owner. Invite teammates from *Settings → Members* (the invite link is shown for copying when email is not configured).

## 3. Connect Freshchat (Settings → Freshchat connection)

You need three things from Freshchat:

1. **API URL**: your Freshchat domain, e.g. `https://yourcompany.freshchat.com`. (Freshsales Suite accounts use `https://yourcompany-xxxx.myfreshworks.com/crm/...`; paste what Freshchat shows under *Admin → API Settings*.)
2. **API key**: *Admin Settings → API Settings* (some plans call it *API tokens*). Create one with access to conversations, messages, users and agents.
3. **Reply agent**: create a dedicated agent seat for the bot (for example "Ava · Support"). FreshQA posts every reply as that agent, so customers see a name and photo, and FreshQA can tell your teammates' messages apart from its own. Pick it in the dropdown after the connection is verified.

Optional: the Freshchat **app id** (shown in the widget install snippet) rejects events from another account; the **webhook public key** (from *Admin → Webhooks*) turns on signature checks.

Click **Save & verify**. FreshQA lists your agents through the API to prove the key works.

## 4. Choose how FreshQA hears about messages

**Option A — the sidebar app (recommended).** It gives agents the Take over / Hand back buttons *and* forwards conversation events, so the account webhook stays free. Follow `sidebar-app/README.md`: issue a token in *Settings → Freshchat sidebar*, pack the app with `fdk pack`, upload it as a Custom App, and enter your FreshQA host and the token on the install form.

**Option B — the account webhook.** *Admin Settings → Webhooks*: paste the **Webhook URL** shown in *Settings → Freshchat connection* and enable `message_create`, `conversation_assignment`, `conversation_resolution`, `conversation_reopen`.

Both can be on at the same time; events are de-duplicated by message id.

## 5. Add knowledge (Knowledge tab)

1. **New draft** → add documents: paste text, upload `.txt`/`.md`, or import a help-centre URL. Markdown headings become sections, which improves retrieval.
2. Use **Test chat** to ask real customer questions. Each answer shows its confidence, the excerpts it cited, and what the gate would do.
3. Add a few **golden tests** (question + expected answer) and **Run tests**. Fix the documents until they pass.
4. **Activate** the draft.

## 6. Go live safely (Settings → Agent)

1. Set mode to **Shadow**. Chat as a customer through your website widget. Open the conversation in FreshQA: you will see the draft the agent *would* have sent, with its reasons. Nothing reaches the customer.
2. Adjust the persona, confidence threshold, and handoff phrases.
3. Switch to **Live**. From now on the agent answers every new customer message within ~3 seconds of the last one in a burst.

Taking over: reply from Freshchat as any other agent (FreshQA notices and steps back), or press **Take over** in the sidebar. Press **Hand back** to let the agent continue.

## Troubleshooting

- *Sidebar says "Freshchat did not initialize the app"*: you uploaded raw source instead of the `fdk pack` ZIP.
- *Agent never replies*: check the Activity tab. `turn_skipped: mode_off`, `no_reply_agent`, or `no_active_knowledge` tell you which step is missing. `ingest` rows prove events arrive.
- *Every answer hands off*: the knowledge does not cover the question, or the threshold is too high. Test chat shows the retrieved excerpts and confidence.
- *Freshchat webhook shows failures*: the URL must be public (tunnel running) and contain the current secret; rotating the secret invalidates the old URL.
- *Replies appear as "bot" or fail to send*: the reply agent must be an active agent seat on the account; deactivated agents are rejected.

## Local testing without a Freshchat account

`scripts/mock-freshchat.mjs` is a fake Freshchat: it serves the five API calls FreshQA makes and can play the customer.

```bash
npm run mock:freshchat                    # http://localhost:8790
# In FreshQA: connect with API URL http://localhost:8790 and any key, pick "Ava Support" as the reply agent,
# copy the Webhook URL from Settings, then:
curl -H 'Content-Type: application/json' -d '{"webhook":"<that URL>"}' http://localhost:8790/mock/config
curl -H 'Content-Type: application/json' -d '{"conversationId":"conv-1","text":"Do you ship to Canada?"}' http://localhost:8790/mock/customer
curl -H 'Content-Type: application/json' -d '{"conversationId":"conv-1","text":"Sam here, I got this"}' http://localhost:8790/mock/human
```

`npm run db:reset` wipes the local database.
