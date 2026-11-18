-- PMSC Estudos: sincronização SEM login, por código secreto (UUID).
-- Cole no Supabase: SQL Editor > New query > Run.

-- Remove a tabela da versão com login (não é mais usada).
drop table if exists public.estudos;

create table if not exists public.estudos_codigo (
  codigo     uuid primary key,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- RLS ligado e SEM políticas: ninguém acessa a tabela diretamente.
alter table public.estudos_codigo enable row level security;
revoke all on public.estudos_codigo from anon, authenticated;

-- Acesso só pelas funções abaixo, que exigem o código.
create or replace function public.pmsc_ler(p_codigo uuid)
returns table (data jsonb, updated_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select e.data, e.updated_at from public.estudos_codigo e where e.codigo = p_codigo;
$$;

create or replace function public.pmsc_salvar(p_codigo uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_column_size(p_data) > 2000000 then
    raise exception 'dados grandes demais';
  end if;
  insert into public.estudos_codigo (codigo, data, updated_at)
  values (p_codigo, p_data, now())
  on conflict (codigo) do update set data = excluded.data, updated_at = now();
end;
$$;

revoke all on function public.pmsc_ler(uuid) from public;
revoke all on function public.pmsc_salvar(uuid, jsonb) from public;
grant execute on function public.pmsc_ler(uuid) to anon, authenticated;
grant execute on function public.pmsc_salvar(uuid, jsonb) to anon, authenticated;
