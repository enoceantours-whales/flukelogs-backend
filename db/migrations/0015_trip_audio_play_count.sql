-- ============================================================================
-- Migration 0015 — audio play count
-- ============================================================================
-- Tracks how many times each trip's captain audio note has been played on the
-- public sightings widget — shown as social proof next to the player, and in
-- the captain's Past Trips list.
--
-- The widget runs on the anon key and can't safely do `play_count + 1` as a
-- PostgREST PATCH (that races). increment_audio_play() does the atomic bump;
-- it is SECURITY DEFINER and granted to anon so the public widget can call it
-- as an RPC, but it can only ever increment this one counter — nothing else.
--
-- Idempotent. Paste into Supabase Dashboard -> SQL Editor -> Run.

alter table public.trip_audio
  add column if not exists play_count integer not null default 0;

comment on column public.trip_audio.play_count is
  'Times the trip audio note has been played on the public sightings widget.';

-- Atomic +1 on one row. SECURITY DEFINER so an anon caller (the widget) can
-- run it without any direct write access to trip_audio; search_path pinned
-- so the definer rights can't be abused via shadowed object lookups.
create or replace function public.increment_audio_play(tid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.trip_audio set play_count = play_count + 1 where trip_id = tid;
$$;

revoke execute on function public.increment_audio_play(uuid) from public;
grant  execute on function public.increment_audio_play(uuid) to anon, authenticated;

-- ── Verify ───────────────────────────────────────────────────────────
--   select trip_id, play_count from trip_audio;
--   select increment_audio_play('<some-trip-id>');  -- play_count should climb
