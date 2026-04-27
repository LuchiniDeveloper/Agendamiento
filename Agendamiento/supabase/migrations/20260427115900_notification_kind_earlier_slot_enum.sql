-- Enum value must be committed in its own migration before any statement in a later
-- migration references 'EARLIER_SLOT_AVAILABLE' (PostgreSQL: 55P04).

do $$
begin
  alter type public.notification_kind add value if not exists 'EARLIER_SLOT_AVAILABLE';
exception
  when duplicate_object then null;
end $$;
