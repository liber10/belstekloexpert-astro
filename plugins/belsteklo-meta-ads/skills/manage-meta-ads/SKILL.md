---
name: manage-meta-ads
description: Analyze and safely manage BelStekloExpert Meta Ads through the local guarded MCP. Use for Meta, Facebook, or Instagram ad-account audits, campaign/ad-set/ad insights, change proposals, bounded pause/resume or budget changes, externally approved PAUSED website-leads bundles, and Meta automation planning.
---

# Manage BelStekloExpert Meta Ads

Use the `belsteklo-meta-ads` MCP tools. Never ask the user to paste a Meta token,
account ID, lead payload, phone number, or form response into chat.

## Required sequence

1. Call `meta_connection_status` and `meta_get_guardrails`.
2. Before the first write, call read-only `meta_validate_write_access`. Stop if
   `ready_for_guarded_write` is false or least-privilege scopes are unconfirmed.
3. Read structure and Insights before proposing changes. Prefer completed days;
   avoid acting on an incomplete current day.
4. Evaluate qualified, booked, won, revenue, and lost-reason data from Lead Hub
   when available. Raw Instant Form CPL alone is not a quality signal.
5. State evidence, expected effect, downside, and rollback before a write.
6. Call `meta_prepare_change`; present its diff without exposing raw identifiers.
7. In `guarded` mode, obtain explicit user approval before `meta_apply_change`.
8. After apply, report the read-after-write result and audit status.

For a campaign bundle, keep it separate from ordinary change sets: prepare the
exact plan, show only its safe preview and hash, require a detached Ed25519 human
approval created outside MCP, dry-run with zero Graph POSTs, and materialize only
after both guarded modes and the dedicated creation kill switch are enabled.

## Write policy

- Allowed: pause, resume, bounded daily-budget changes, and the narrowly scoped
  campaign-bundle v1 described below.
- Never delete, archive, change billing, users, roles or account spend caps, and
  never mutate existing audiences or targeting.
- Campaign-bundle v1 may create exactly one allow-listed `OUTCOME_LEADS` website
  campaign, one ad set, and 1–3 ads, all delivery objects `PAUSED`. It must use
  only Page, Pixel, media, broad location targeting template and landing host from
  the strict external catalog/policy.
- Price copy is allowed only as exact text from a current evidence-backed catalog
  claim with a separate business-offer approval ref, the required inspection
  disclaimer, and validity covering the full campaign. Never infer, round, or
  rewrite a price outside that approved text.
- Never activate or publish the bundle, upload media, create an Instant Form,
  accept arbitrary targeting, or delete an object.
- Never bypass account allowlists, percentage/absolute budget caps, TTL, cooldown,
  exact plan hash, catalog hash, detached approval, policy/mode binding, durable
  ledger, account lock, reconciliation, or stale-state checks.
- Treat `autopilot` as a pre-approved bounded operations mode. It may pause or
  reduce a budget only. It may not create, resume or increase a budget.
- Stop writes when data is stale, attribution is inconsistent, Meta reports an API
  error, or Lead Hub quality signals are missing.
- Treat an unknown Graph POST outcome as locked, not retryable. Reconcile known
  provider state before proposing another create operation.

## Analysis standard

Report at least spend, impressions, reach, frequency, CPM, CTR, CPC, Meta leads,
qualified leads, booked/won outcomes, raw CPL and qualified CPL when those inputs
exist. Explicitly label missing denominators and non-aligned reporting windows.
