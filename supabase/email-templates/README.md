# Supabase Auth — Email templates

These HTML files are the source of truth for the branded Supabase Auth
emails. They are **not** auto-deployed — Supabase has no API for email
templates, so changes here are checked in for version control + review,
and applied by hand in the dashboard.

## Apply

1. Supabase Dashboard → **Authentication** → **Email Templates**.
2. For each template below: set the subject line, paste the file's
   body into **Message body (HTML)**, click **Save**.
3. Send a test from `/profile` in a private window to confirm.

| File                  | Dashboard template | Subject |
|-----------------------|--------------------|---------|
| `magic-link.html`     | Magic Link         | Sign in to your Wildlife Log |
| `confirm-signup.html` | Confirm signup     | Welcome aboard — finish setting up your Wildlife Log |

When Supabase actually fires which one:

- **Confirm signup** — first time an email shows up in `signInWithOtp`
  (the user is created during this call). Lands on `/profile` ready to
  create their profile + set a password.
- **Magic Link** — every subsequent `signInWithOtp` for that email,
  *unless* the user signs in with a password instead.

## Preview locally

The templates use absolute styles, so you can open the `.html` files
directly in a browser. The `{{ .ConfirmationURL }}` placeholders stay
literal until Supabase substitutes them on send.

## Branding scope

Currently Enocean Tours specific. When operator #2 onboards, the move
is either to genericize the copy ("your Wildlife Log") and drop the
"Enocean Tours" footer line, or split into a transactional provider
(Resend / Postmark) where each operator gets its own template.
