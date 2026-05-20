-- ============================================================================
-- Migration 0012 — operator timezone
-- ============================================================================
-- A trip's calendar date (trip_date) must be the date in the OPERATOR's local
-- timezone, never UTC. send-report.js prefers the client-supplied local date,
-- but older cached app builds don't send one. In that case the server now
-- derives trip_date from the trip's startTime in this timezone instead of
-- falling back to UTC — a 5pm Pacific trip is already past midnight UTC, so
-- the UTC fallback used to stamp it with tomorrow's date.
--
-- IANA timezone name (e.g. 'America/Los_Angeles'). Defaults to US Pacific —
-- the timezone of the current operator. Operators in other regions should
-- set their own.
--
-- Idempotent. Paste into Supabase Dashboard → SQL Editor → Run.

alter table public.operators
  add column if not exists timezone text not null default 'America/Los_Angeles';

comment on column public.operators.timezone is
  'IANA timezone name for the operator. Used server-side to stamp trip_date with the operator''s local calendar date instead of UTC.';
