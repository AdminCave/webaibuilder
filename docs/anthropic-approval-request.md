# Approval request to Anthropic — subscription use via the customer's own Claude Code CLI

> **Status:** Draft. Written in English (Anthropic's partnerships/developer-relations team). Placeholders are in `[square brackets]` — fill in before sending. Sending path and explanation: see "Notes on sending" below.

---

**Subject:** Approval request — third-party desktop app driving the customer's own Claude Code CLI (Web AI Builder / AdminCave)

Hi Anthropic team,

I'm [Kevin Stenzel], the developer behind **AdminCave** ([short description, e.g. "an independent, DACH-focused project that builds tooling to make sysadmins' lives easier"]; [website/URL, if available]). I'm reaching out to request approval for a specific, narrowly-scoped integration with Claude, and to confirm my reading of your policies before I ship.

## What the product is

**Web AI Builder** is a local desktop application (Electron, currently pre-release) that lets non-expert users build small static websites by chatting with an AI, see a live preview, keep automatic versioned checkpoints, and deploy the result to classic shared-hosting webspace over SFTP/FTP with one click. Its target audience is the "reluctant webmaster" in the German-speaking market — the IT-literate person who maintains a site for a club, family, or small business on traditional hosting.

The app is model-agnostic: users bring their own AI. **API keys are the default and recommended path** (Anthropic, plus other providers). Separately, we would like to offer an optional mode where a user can drive their **own, already-installed and already-logged-in Claude Code CLI**, so that Claude Pro/Max subscribers can use the subscription they already pay for.

## The specific request

**We would like your approval to let end users, inside Web AI Builder, use their own Claude Pro/Max subscription by having our app invoke the official `claude` CLI that the user has installed and logged into themselves — and to describe this capability in our product.**

## Exactly how the integration works (and what it deliberately does not do)

We have read the Claude Agent SDK overview ("Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products…") and the Claude Code legal-and-compliance guidance, and we architected specifically to stay within them:

- **The app only spawns the user's own, unmodified, officially-installed `claude` CLI** as a subprocess (`claude -p --output-format stream-json …`) in the project directory. The subscription login lives entirely in that CLI, managed by the user through your own official flow.
- **The app never reads, stores, proxies, transmits, or otherwise touches OAuth tokens or subscription credentials.** There is no "Sign in with Claude" in our UI; there is no `setup-token` handling; there is no server-side component that sees subscription traffic.
- **No rerouting or spoofing.** We do not set `ANTHROPIC_BASE_URL`, we do not proxy requests, and we do not impersonate the official harness. The CLI talks to Anthropic exactly as it would on its own.
- **API-key mode is the foundation and the fallback**, and it is what we recommend to users for Anthropic. The subscription mode is strictly opt-in.
- **We already gate this mode behind a feature flag and show an in-app notice** explaining that it uses the user's own Claude subscription via their own installed CLI, that they must have installed and logged in themselves, that we store no tokens, and that Anthropic restricts third-party subscription login unless approved. We are happy to keep it disabled until you approve it, and we have a per-provider remote kill-switch so we can turn it off immediately if your policy changes.
- **Branding:** we do not use "Claude Code" as our product name and we do not imply we are an Anthropic product. We would use neutral wording such as "works with your Claude subscription." We will follow whatever branding guidance you require.

In short: from Anthropic's perspective this is a real Claude subscriber running your own official CLI on their own machine — we are only the local UI that starts it.

## Questions

1. Is the pattern above — our app spawning the user's own installed, logged-in `claude` CLI, with no credential handling on our side — permitted, and if so under what conditions?
2. Does approving it require a formal partnership/agreement, or is a written confirmation sufficient?
3. Are there branding or disclosure requirements you want us to meet?
4. Given the Agent-SDK usage-metering change that was announced and then paused (June 15, 2026), is there anything about that direction we should design for now so we don't build toward something you intend to change?

We would rather do this correctly and with your blessing than ship something that surprises you. I'm happy to provide more technical detail, walk through the integration on a call, or adjust the design to meet your requirements.

Thank you for your time.

Best regards,
[Kevin Stenzel]
[Email: mail@kevin-stenzel.de]
[AdminCave — website/contact, if available]

---

## Notes on sending (do not include)

**Language:** English is deliberate — Anthropic's partnerships/developer-relations team reads English, and the quoted clauses appear that way in their docs.

**Fill in/check before sending:**
- `[Kevin Stenzel]` — your name (2×: at the top and in the signature).
- AdminCave short description and, if applicable, website/URL. Decide for yourself whether you are acting as an individual or as an organization — Anthropic may ask about this.
- Whether there is already a release/publication timeline (you can add it, but you don't have to).
- Email signature (mail@kevin-stenzel.de is entered — change it if you want to use a different address).

**Where to send (Anthropic names no dedicated "approval" channel):**
- **First choice:** partnerships/sales via the contact form on `anthropic.com` (or `claude.com`) — select "partnerships"/"sales" there and paste this text.
- **Alternatively:** the developer/support contact (`support.claude.com`). If you write there, ask in the first sentence to be forwarded to the team that decides on third-party Agent-SDK/subscription use.
- Do not invent an address — use the path officially listed on the website at the time of sending.

**Why the request is well-positioned:** We are effectively asking for confirmation of a pattern that, per Anthropic's own help article of 2026-06-15, is currently tolerated ("third-party app usage still draws from your subscription's usage limits") and that Zed and JetBrains run in a similar form. The risk for Anthropic is low (a real subscriber, their own official CLI, no token handling on our side), and we offer a feature flag + kill switch as a gesture of good faith.

**Realistic expectation:** A quick, binding commitment is not guaranteed — Anthropic has changed direction several times. That is why API-key mode remains the recommended default, and subscription mode stays behind the feature flag until there is a response. Whatever the answer: document it (date, contact person, wording) for the compliance history.
