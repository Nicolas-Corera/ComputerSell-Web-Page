-- Helpers para los casos de prueba (se aplican después de las migraciones).
--   select sandbox.as_user('<uuid>');  -- rol authenticated + claim sub, sesión con 2FA (aal2)
--   select sandbox.as_user('<uuid>', 'aal1');  -- igual pero solo con contraseña (sin 2FA)
--   select sandbox.as_anon();          -- rol anon, sin claims
--   select sandbox.as_service();       -- rol service_role (backend)
--   select sandbox.as_operator();      -- superusuario sin JWT (Management API / scripts)
--   select test.ok(cond, 'mensaje');   -- falla el caso si cond no es true
--   select test.fails('sql', 'patrón'); -- falla si el SQL no tira un error que matchee
create schema if not exists sandbox;
create or replace function sandbox.clear_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', '', false);
end $$;
-- as_user: sesión con 2FA verificado (aal2), como un admin que ya pasó el
-- segundo factor; para un cliente da igual. as_user(u, 'aal1'): solo contraseña.
create or replace function sandbox.as_user(u uuid, aal text default 'aal2') returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated', 'aal', aal)::text, false);
  perform set_config('request.jwt.claim.sub', u::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  execute 'set role authenticated';
end $$;
create or replace function sandbox.as_anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform sandbox.clear_claims();
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  perform set_config('request.jwt.claim.role', 'anon', false);
  execute 'set role anon';
end $$;
create or replace function sandbox.as_service() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform sandbox.clear_claims();
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
  execute 'set role service_role';
end $$;
create or replace function sandbox.as_operator() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform sandbox.clear_claims();
end $$;
grant usage on schema sandbox to anon, authenticated, service_role;
grant execute on all functions in schema sandbox to anon, authenticated, service_role;

create schema if not exists test;
create or replace function test.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
create or replace function test.fails(stmt text, pattern text, msg text default null) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ~* pattern then
      raise notice 'ok: % (error esperado: %)', coalesce(msg, stmt), sqlerrm;
      return;
    end if;
    raise exception 'FAIL: % -> error inesperado: %', coalesce(msg, stmt), sqlerrm;
  end;
  raise exception 'FAIL: % -> se esperaba un error "%" y no hubo', coalesce(msg, stmt), pattern;
end $$;
grant usage on schema test to anon, authenticated, service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;
