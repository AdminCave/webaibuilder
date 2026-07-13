# Approval request to Anthropic — subscription use via the customer's own Claude Code CLI

> **Status:** Entwurf. Auf Englisch verfasst (Anthropics Partnerschafts-/Developer-Relations-Team). Platzhalter stehen in `[eckigen Klammern]` — vor dem Versand ausfüllen. Versandweg und Erläuterung: siehe unten „Hinweise zum Versand".

---

**Subject:** Approval request — third-party desktop app driving the customer's own Claude Code CLI (Web AI Builder / AdminCave)

Hi Anthropic team,

I'm [Kevin Stenzel], the developer behind **AdminCave** ([kurze Beschreibung, z. B. "an independent, DACH-focused project that builds tooling to make sysadmins' lives easier"]; [Website/URL, falls vorhanden]). I'm reaching out to request approval for a specific, narrowly-scoped integration with Claude, and to confirm my reading of your policies before I ship.

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
[E-Mail: mail@kevin-stenzel.de]
[AdminCave — Website/Kontakt, falls vorhanden]

---

## Hinweise zum Versand (nicht mitschicken)

**Sprache:** Englisch ist bewusst gewählt — Anthropics Partnerschafts-/Developer-Relations-Team liest Englisch, und die zitierten Klauseln stehen so in deren Docs.

**Vor dem Absenden ausfüllen/prüfen:**
- `[Kevin Stenzel]` — dein Name (2×: oben und in der Signatur).
- AdminCave-Kurzbeschreibung und ggf. Website/URL. Kläre für dich, ob du als Einzelperson oder als Organisation auftrittst — Anthropic fragt das ggf. nach.
- Ob es schon eine Release-/Veröffentlichungs-Zeitschiene gibt (kann man ergänzen, muss aber nicht).
- E-Mail-Signatur (mail@kevin-stenzel.de ist eingetragen — anpassen, falls du eine andere Adresse nutzen willst).

**Wohin schicken (Anthropic nennt keinen dedizierten „Approval"-Kanal):**
- **Erste Wahl:** Partnerschaften/Sales über das Kontaktformular auf `anthropic.com` (bzw. `claude.com`) — dort „partnerships"/„sales" wählen und diesen Text einfügen.
- **Alternativ:** Developer-/Support-Kontakt (`support.claude.com`). Wenn du dort schreibst, bitte im ersten Satz um Weiterleitung an das Team, das über Agent-SDK-/Subscription-Nutzung durch Dritte entscheidet.
- Erfinde keine Adresse — nimm den offiziell auf der Website ausgewiesenen Weg zum Zeitpunkt des Versands.

**Warum die Anfrage gut steht:** Wir bitten faktisch um Bestätigung eines Musters, das laut Anthropics eigenem Hilfe-Artikel vom 15.06.2026 aktuell geduldet ist („third-party app usage still draws from your subscription's usage limits"), und das Zed und JetBrains in ähnlicher Form fahren. Das Risiko für Anthropic ist gering (echter Abonnent, eigene offizielle CLI, kein Token-Handling bei uns), und wir bieten Feature-Flag + Kill-Switch als Vertrauensvorschuss an.

**Realistische Erwartung:** Eine schnelle, verbindliche Zusage ist nicht garantiert — Anthropic hat die Richtung mehrfach geändert. Deshalb bleibt der API-Key-Modus der empfohlene Standard, und der Abo-Modus bleibt bis zu einer Antwort hinter dem Feature-Flag. Egal wie die Antwort ausfällt: dokumentiere sie (Datum, Ansprechpartner, Wortlaut) für die Compliance-Historie.
