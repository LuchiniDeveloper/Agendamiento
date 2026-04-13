-- Permitir dos franjas por día y servicio (p. ej. mañana + tarde con almuerzo).
alter table public.schedule
  add column if not exists window_order smallint not null default 1;

alter table public.schedule
  drop constraint if exists schedule_window_order_chk;

alter table public.schedule
  add constraint schedule_window_order_chk
  check (window_order in (1, 2));

drop index if exists public.idx_schedule_user_day_service_unique;

create unique index if not exists idx_schedule_user_day_service_window_unique
  on public.schedule (user_id, day_of_week, service_id, window_order)
  nulls not distinct;

comment on column public.schedule.window_order is
  '1 = primera franja del día, 2 = segunda (p. ej. después del almuerzo).';
