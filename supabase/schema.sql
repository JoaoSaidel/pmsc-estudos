-- PMSC Estudos: uma linha por usuário com todo o estado do app (JSON).
-- Cole no Supabase: SQL Editor > New query > Run.

create table if not exists public.estudos (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.estudos enable row level security;

-- Cada usuário só enxerga e altera a própria linha.
drop policy if exists "estudos_select_proprio" on public.estudos;
create policy "estudos_select_proprio" on public.estudos
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "estudos_insert_proprio" on public.estudos;
create policy "estudos_insert_proprio" on public.estudos
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "estudos_update_proprio" on public.estudos;
create policy "estudos_update_proprio" on public.estudos
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Usuário anônimo não acessa nada; autenticado só o que as políticas permitem.
revoke all on public.estudos from anon;
grant select, insert, update on public.estudos to authenticated;
