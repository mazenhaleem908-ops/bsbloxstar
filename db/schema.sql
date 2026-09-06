CREATE TABLE IF NOT EXISTS rate_limit_buckets (key text PRIMARY KEY, window_start timestamptz NOT NULL DEFAULT now(), hits integer NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS rate_limit_buckets_window_idx ON rate_limit_buckets(window_start);

-- BloxStar — Neon PostgreSQL schema
-- Apply once against your Neon database:
--   psql "$DATABASE_URL" -f db/schema.sql

CREATE TABLE IF NOT EXISTS auth_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_codes_email_idx ON auth_codes (email);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token text PRIMARY KEY,
  email text NOT NULL,
  admin boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_email_idx ON auth_sessions (email);

-- Google OAuth / OIDC: pending authorization requests (state + PKCE verifier).
CREATE TABLE IF NOT EXISTS auth_oauth_states (
  state text PRIMARY KEY,
  code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  return_to text NOT NULL DEFAULT '/',
  nonce text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Google OAuth / OIDC: single-use hand-off codes swapped for a session token.
CREATE TABLE IF NOT EXISTS auth_login_codes (
  code text PRIMARY KEY,
  token text NOT NULL,
  email text NOT NULL,
  admin boolean NOT NULL DEFAULT false,
  name text,
  picture text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS orders (
  code text PRIMARY KEY,
  intent_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending_payment',
  paid boolean NOT NULL DEFAULT false,
  email text,
  roblox_user text,
  game text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  fee numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reservation_expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS orders_reservation_expires_idx ON orders (reservation_expires_at) WHERE reservation_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_email_idx ON orders (email);

CREATE TABLE IF NOT EXISTS item_stock (
  item_id integer PRIMARY KEY,
  qty integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION reserve_stock(p_items jsonb, p_default integer DEFAULT 12)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  line jsonb;
  iid integer;
  need integer;
  have integer;
BEGIN
  FOR line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    iid := (line->>'id')::integer;
    need := GREATEST(1, COALESCE((line->>'q')::integer, 1));
    INSERT INTO item_stock(item_id, qty)
      VALUES (iid, p_default)
      ON CONFLICT (item_id) DO NOTHING;
    SELECT qty INTO have FROM item_stock WHERE item_id = iid FOR UPDATE;
    IF have IS NULL OR have < need THEN
      RAISE EXCEPTION 'out_of_stock:%', iid;
    END IF;
    UPDATE item_stock SET qty = qty - need, updated_at = now() WHERE item_id = iid;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION release_stock(p_items jsonb)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  line jsonb;
BEGIN
  FOR line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    UPDATE item_stock
       SET qty = qty + GREATEST(1, COALESCE((line->>'q')::integer, 1)), updated_at = now()
     WHERE item_id = (line->>'id')::integer;
  END LOOP;
  RETURN true;
END;
$$;


CREATE OR REPLACE FUNCTION create_order_atomic(
  p_code text, p_intent_id text, p_email text, p_roblox_user text, p_game text,
  p_items jsonb, p_subtotal numeric, p_fee numeric, p_total numeric, p_data jsonb
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE existing_code text;
BEGIN
  SELECT code INTO existing_code FROM orders WHERE intent_id=p_intent_id FOR UPDATE;
  IF existing_code IS NOT NULL THEN RETURN existing_code; END IF;
  PERFORM reserve_stock(p_items, 12);
  INSERT INTO orders(code,intent_id,status,paid,email,roblox_user,game,items,subtotal,fee,total,data,reservation_expires_at)
  VALUES(p_code,p_intent_id,'pending_payment',false,p_email,p_roblox_user,p_game,p_items,p_subtotal,p_fee,p_total,p_data,now()+interval '30 minutes');
  RETURN p_code;
END; $$;

CREATE OR REPLACE FUNCTION release_expired_orders() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r record; n integer:=0;
BEGIN
  FOR r IN SELECT code,items FROM orders WHERE reservation_expires_at IS NOT NULL AND reservation_expires_at<now() AND status IN ('pending_payment','pending','processing') FOR UPDATE LOOP
    PERFORM release_stock(r.items);
    UPDATE orders SET status='cancelled',paid=false,reservation_expires_at=NULL,updated_at=now() WHERE code=r.code; n:=n+1;
  END LOOP; RETURN n;
END; $$;

-- Wallet / balance (server-side, cross-device). Previously the balance was
-- stored in the browser's localStorage, which made it disappear on other devices.
CREATE TABLE IF NOT EXISTS user_account_data (
  email text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  email text PRIMARY KEY,
  balance numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_tx (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  kind text NOT NULL,
  amount numeric(12,2) NOT NULL,
  note text NOT NULL DEFAULT '',
  ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_tx_email_idx ON wallet_tx (email, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_tx_ref_idx ON wallet_tx (ref) WHERE ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS gift_cards (
  code text PRIMARY KEY,
  amount numeric(12,2) NOT NULL,
  redeemed_by text,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO gift_cards (code, amount) VALUES ('BLOX-10', 10), ('BLOX-25', 25), ('STAR-50', 50)
  ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS wallet_withdrawals (
  id text PRIMARY KEY,
  email text NOT NULL,
  amount numeric(12,2) NOT NULL,
  method text NOT NULL DEFAULT '',
  dest text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION wallet_spend(p_email text,p_amount numeric,p_kind text,p_note text,p_ref text)
RETURNS numeric LANGUAGE plpgsql AS $$ DECLARE b numeric; BEGIN
  UPDATE wallets SET balance=balance-p_amount,updated_at=now() WHERE email=p_email AND balance>=p_amount RETURNING balance INTO b;
  IF b IS NULL THEN RAISE EXCEPTION 'insufficient_funds'; END IF;
  INSERT INTO wallet_tx(email,kind,amount,note,ref) VALUES(p_email,p_kind,-p_amount,left(p_note,200),p_ref);
  RETURN b;
END; $$;

CREATE OR REPLACE FUNCTION wallet_credit(p_email text,p_amount numeric,p_kind text,p_note text,p_ref text)
RETURNS numeric LANGUAGE plpgsql AS $$ DECLARE b numeric; BEGIN
  IF p_ref IS NOT NULL AND EXISTS(SELECT 1 FROM wallet_tx WHERE ref=p_ref) THEN
    SELECT balance INTO b FROM wallets WHERE email=p_email; RETURN COALESCE(b,0);
  END IF;
  INSERT INTO wallets(email,balance) VALUES(p_email,p_amount) ON CONFLICT(email) DO UPDATE SET balance=wallets.balance+p_amount,updated_at=now() RETURNING balance INTO b;
  INSERT INTO wallet_tx(email,kind,amount,note,ref) VALUES(p_email,p_kind,p_amount,left(p_note,200),p_ref) ON CONFLICT DO NOTHING;
  RETURN b;
END; $$;

CREATE OR REPLACE FUNCTION wallet_withdraw_atomic(p_id text,p_email text,p_amount numeric,p_method text,p_dest text)
RETURNS numeric LANGUAGE plpgsql AS $$ DECLARE b numeric; BEGIN
  UPDATE wallets SET balance=balance-p_amount,updated_at=now() WHERE email=p_email AND balance>=p_amount RETURNING balance INTO b;
  IF b IS NULL THEN RAISE EXCEPTION 'insufficient_funds'; END IF;
  INSERT INTO wallet_withdrawals(id,email,amount,method,dest) VALUES(p_id,p_email,p_amount,left(p_method,40),left(p_dest,200));
  INSERT INTO wallet_tx(email,kind,amount,note,ref) VALUES(p_email,'withdraw',-p_amount,'Withdrawal · '||upper(left(p_method,40)),'withdraw:'||p_id);
  RETURN b;
END; $$;

CREATE OR REPLACE FUNCTION wallet_redeem_gift(p_email text,p_code text)
RETURNS numeric LANGUAGE plpgsql AS $$ DECLARE a numeric; b numeric; BEGIN
  UPDATE gift_cards SET redeemed_by=p_email,redeemed_at=now() WHERE code=p_code AND redeemed_by IS NULL RETURNING amount INTO a;
  IF a IS NULL THEN RAISE EXCEPTION 'invalid_or_used'; END IF;
  INSERT INTO wallets(email,balance) VALUES(p_email,a) ON CONFLICT(email) DO UPDATE SET balance=wallets.balance+a,updated_at=now() RETURNING balance INTO b;
  INSERT INTO wallet_tx(email,kind,amount,note,ref) VALUES(p_email,'giftcard',a,'Gift card '||p_code,'gift:'||p_code);
  RETURN b;
END; $$;

CREATE OR REPLACE FUNCTION wallet_reward(p_email text,p_amount numeric)
RETURNS numeric LANGUAGE plpgsql AS $$ DECLARE last_at timestamptz; b numeric; BEGIN
  SELECT created_at INTO last_at FROM wallet_tx WHERE email=p_email AND kind='wheel' ORDER BY created_at DESC LIMIT 1;
  IF last_at IS NOT NULL AND last_at>now()-interval '12 hours' THEN RAISE EXCEPTION 'cooldown'; END IF;
  INSERT INTO wallets(email,balance) VALUES(p_email,p_amount) ON CONFLICT(email) DO UPDATE SET balance=wallets.balance+p_amount,updated_at=now() RETURNING balance INTO b;
  INSERT INTO wallet_tx(email,kind,amount,note) VALUES(p_email,'wheel',p_amount,'Wheel of Fortune prize'); RETURN b;
END; $$;
