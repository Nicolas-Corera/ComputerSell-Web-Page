-- Límite de envíos de correo (formulario de contacto). Lo usa solo el backend
-- con el service role: api/_lib/mail.js -> mail_rate_hit(p_rules).
-- p_rules = [{key, limit, window (segundos, máx. 1 día)}]: si alguna regla ya
-- llegó al límite devuelve false y no registra nada; si no, registra todas.
create table if not exists public.mail_rate (
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists mail_rate_key_idx on public.mail_rate (key, created_at desc);
create index if not exists mail_rate_created_idx on public.mail_rate (created_at);

alter table public.mail_rate enable row level security;
revoke all on public.mail_rate from anon, authenticated;

create or replace function public.mail_rate_hit(p_rules jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) = 0 then
    return false;
  end if;

  for r in select value from jsonb_array_elements(p_rules) order by value->>'key' loop
    perform pg_advisory_xact_lock(hashtext('mail_rate:' || (r->>'key')));
  end loop;

  delete from public.mail_rate where created_at < now() - interval '1 day';

  for r in select value from jsonb_array_elements(p_rules) loop
    if (select count(*) from public.mail_rate
        where key = r->>'key'
          and created_at > now() - make_interval(secs => least(greatest((r->>'window')::int, 1), 86400)))
       >= greatest((r->>'limit')::int, 0) then
      return false;
    end if;
  end loop;

  insert into public.mail_rate (key)
  select value->>'key' from jsonb_array_elements(p_rules);
  return true;
end;
$$;

revoke execute on function public.mail_rate_hit(jsonb) from public, anon, authenticated;
grant execute on function public.mail_rate_hit(jsonb) to service_role;
