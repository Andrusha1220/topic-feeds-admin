// Topic Feeds admin panel: a static page (GitHub Pages) over the Supabase Auth and Data APIs, in
// plain fetch like the extension's supa.js. Signing in uses Supabase's Google redirect; every
// read and write is an admin_* function, which refuses anyone not in public.admins
// (supabase/migrations/20261015222837_admin_plans.sql).
//
// Routes (hash, since Pages can't rewrite paths):
//   #/plans             Plans & access: the free plan's feed limit, and every user
//   #/plans/users/<id>  one user, with the Plus toggle

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const EARLY_MS = 60 * 1000;

const $ = (sel) => document.querySelector(sel);
const main = $('#main');

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

// ---------- formatting ----------

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const when = (iso) => (iso ? dateTime.format(new Date(iso)) : '—');
const day = (iso) => (iso ? dateOnly.format(new Date(iso)) : '—');
function ago(iso) {
  if (!iso) return 'never';
  const s = (new Date(iso) - Date.now()) / 1000;
  for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= size) return relative.format(Math.round(s / size), unit);
  }
  return 'just now';
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function toast(text, kind = '') {
  const t = $('#toast');
  t.textContent = text;
  t.className = `toast show ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

// ---------- session ----------

// In memory only: every Pages site of the account shares the origin andrusha1220.github.io, so
// localStorage or sessionStorage would hand the admin's refresh token to any of them. A reload
// means signing in again.
let session = null;
const saveSession = (s) => { session = s; };

class ApiError extends Error {
  constructor(status, body) {
    super(body?.message ?? body?.msg ?? body?.error_description ?? `HTTP ${status}`);
    this.status = status;
    this.code = body?.code ?? body?.error_code ?? null;
  }
}
const notAdmin = (err) => err?.code === '42501';

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

// Google, through Supabase. Supabase sends the browser back here with the session in the hash.
function signIn() {
  const back = location.origin + location.pathname;
  location.assign(`${SUPABASE_URL}/auth/v1/authorize?${new URLSearchParams({ provider: 'google', redirect_to: back })}`);
}

// After the redirect: #access_token=…&refresh_token=…&expires_at=… (or #error=…).
function takeRedirect() {
  const params = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const error = params.get('error_description') ?? query.get('error_description');
  if (params.has('access_token')) {
    saveSession({
      accessToken: params.get('access_token'),
      refreshToken: params.get('refresh_token'),
      expiresAt: Number(params.get('expires_at')) * 1000 || Date.now() + Number(params.get('expires_in')) * 1000,
      email: null
    });
  }
  if (params.has('access_token') || error) history.replaceState(null, '', `${location.pathname}#/plans`);
  return error;
}

let refreshing = null;
async function accessToken() {
  if (!session) throw new ApiError(401, { message: 'signed out' });
  if (session.expiresAt - EARLY_MS > Date.now()) return session.accessToken;
  refreshing ??= call('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', body: { refresh_token: session.refreshToken }
  }).then((r) => {
    saveSession({ accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: r.expires_at * 1000, email: r.user?.email ?? session.email });
    return r.access_token;
  }, (err) => {
    if ([400, 401, 403].includes(err.status)) saveSession(null);
    throw err;
  }).finally(() => { refreshing = null; });
  return refreshing;
}

async function rpc(name, args = {}) {
  try {
    return await call(`/rest/v1/rpc/${name}`, { method: 'POST', token: await accessToken(), body: args });
  } catch (err) {
    if (err.status === 401) { saveSession(null); render(); }
    throw err;
  }
}

async function signOut() {
  const token = session?.accessToken;
  saveSession(null);
  if (token) call('/auth/v1/logout?scope=local', { method: 'POST', token }).catch(() => {});
  location.hash = '#/plans';
  render();
}

// ---------- views ----------

function chrome_({ signedIn, admin }) {
  $('#nav').hidden = !admin;
  $('#me').hidden = !signedIn;
  $('#me-email').textContent = session?.email ?? '';
  for (const a of document.querySelectorAll('#nav a')) {
    a.toggleAttribute('aria-current', location.hash.startsWith(`#/${a.dataset.section}`));
  }
}

function show(...nodes) {
  main.replaceChildren(...nodes);
}

function signedOutView(error) {
  chrome_({ signedIn: false, admin: false });
  show(el('section', { class: 'gate' },
    el('h1', {}, 'Topic Feeds admin'),
    el('p', { class: 'muted' }, 'Sign in with the Google account that has admin access.'),
    error ? el('p', { class: 'error' }, error) : null,
    el('button', { type: 'button', class: 'primary', onclick: signIn }, 'Sign in with Google')));
}

function notAdminView() {
  chrome_({ signedIn: true, admin: false });
  show(el('section', { class: 'gate' },
    el('h1', {}, 'No admin access'),
    el('p', { class: 'muted' }, `${session?.email || 'This account'} isn't an admin. Sign in with another Google account, or add this one to public.admins in Supabase.`),
    el('button', { type: 'button', onclick: signOut }, 'Sign out')));
}

function errorView(err, retry) {
  show(el('section', { class: 'gate' },
    el('h1', {}, 'Couldn’t load'),
    el('p', { class: 'error' }, err.message),
    el('button', { type: 'button', onclick: retry }, 'Try again')));
}

const avatar = (u, size = 32) => u.avatar_url
  ? el('img', { class: 'avatar', src: u.avatar_url, alt: '', width: size, height: size, referrerpolicy: 'no-referrer' })
  : el('span', { class: 'avatar blank', style: `width:${size}px;height:${size}px`, 'aria-hidden': 'true' }, (u.name || u.email || '?').slice(0, 1).toUpperCase());

const planBadge = (u) => el('span', { class: `badge ${u.plus ? 'plus' : ''}` }, u.plus ? 'Plus' : 'Free');

function plusSource(u) {
  const paid = u.plan === 'plus' && u.paid_until && new Date(u.paid_until).getTime() + 86400000 > Date.now();
  if (u.plus_granted && paid) return 'Given by an admin, and paid';
  if (u.plus_granted) return 'Given by an admin';
  if (paid) return 'Paid subscription';
  return null;
}

// Plans & access: the free plan's limit, then every user.
async function plansView() {
  const [settings, users] = await Promise.all([rpc('admin_settings'), rpc('admin_users')]);

  const limit = el('input', {
    type: 'number', id: 'limit', min: 1, max: 100, step: 1, required: true, value: settings.free_feed_limit, inputmode: 'numeric'
  });
  const save = el('button', { type: 'submit', class: 'primary' }, 'Save');
  const limitNote = el('p', { class: 'muted small', id: 'limit-note' },
    settings.updated_by ? `Last changed ${ago(settings.updated_at)} by ${settings.updated_by}.` : 'The built-in default.');
  const limitForm = el('form', {
    class: 'limit-form',
    onsubmit: async (e) => {
      e.preventDefault();
      const n = Number(limit.value);
      if (!Number.isInteger(n) || n < 1 || n > 100) { limit.reportValidity(); return; }
      save.disabled = true;
      try {
        await rpc('admin_set_free_feed_limit', { n });
        limitNote.textContent = 'Saved. Extensions pick it up the next time their feeds page opens (within a few hours for signed-out users).';
        toast(`Free plan: ${plural(n, 'feed', 'feeds')}`);
      } catch (err) {
        toast(notAdmin(err) ? 'No admin access' : `Couldn’t save: ${err.message}`, 'bad');
      } finally {
        save.disabled = false;
      }
    }
  },
  el('label', { for: 'limit' }, 'Feeds allowed on the free plan'),
  el('div', { class: 'row' }, limit, save),
  limitNote);

  const search = el('input', { type: 'search', placeholder: 'Search by email or name', 'aria-label': 'Search users' });
  const list = el('ul', { class: 'users' });
  const count = el('span', { class: 'muted' });
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const shown = users.filter((u) => !q || (u.email ?? '').toLowerCase().includes(q) || (u.name ?? '').toLowerCase().includes(q));
    count.textContent = q ? `${shown.length} of ${users.length}` : plural(users.length, 'user', 'users');
    list.replaceChildren(...shown.map((u) => el('li', {},
      el('a', { href: `#/plans/users/${u.id}`, class: 'user-row' },
        avatar(u),
        el('span', { class: 'who' },
          el('span', { class: 'name' }, u.name || u.email || u.id),
          u.name ? el('span', { class: 'muted small' }, u.email) : null),
        el('span', { class: 'muted small hide-narrow' }, plural(u.feeds, 'feed', 'feeds')),
        el('span', { class: 'muted small hide-narrow', title: when(u.last_sign_in_at) }, ago(u.last_sign_in_at)),
        planBadge(u)))));
    if (!shown.length) list.append(el('li', { class: 'muted empty' }, q ? 'No users match.' : 'No one has signed in yet.'));
  };
  search.addEventListener('input', paint);
  paint();

  return [
    el('header', { class: 'page-head' },
      el('h1', {}, 'Plans & access'),
      el('p', { class: 'muted' }, 'What the free plan allows, and who has Plus.')),
    el('section', { class: 'card' },
      el('h2', {}, 'Free plan'),
      el('p', { class: 'muted' }, 'Making a new feed past this number opens the Plus offer. Feeds people already have stay, even over the limit. Plus has no limit.'),
      limitForm),
    el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', {}, 'Users'), count),
      el('p', { class: 'muted' }, 'Everyone who has signed in to the extension with Google.'),
      search,
      list)];
}

function fact(label, ...value) {
  return [el('dt', {}, label), el('dd', {}, ...value)];
}

async function userView(id) {
  const [u] = await rpc('admin_users', { uid: id });
  if (!u) return [el('a', { href: '#/plans', class: 'back' }, '← Plans & access'), el('p', {}, 'No such user.')];

  const source = el('p', { class: 'muted small' });
  const status = el('span', {});
  const paintPlus = () => {
    status.replaceChildren(planBadge(u));
    const s = plusSource(u);
    source.textContent = s ? `Has Plus: ${s.toLowerCase()}.` : 'On the free plan.';
  };

  const toggle = el('input', { type: 'checkbox', role: 'switch', id: 'plus-toggle', checked: u.plus_granted });
  toggle.addEventListener('change', async () => {
    const on = toggle.checked;
    toggle.disabled = true;
    try {
      await rpc('admin_set_plus', { uid: u.id, plus: on });
      Object.assign(u, (await rpc('admin_users', { uid: u.id }))[0]);
      paintPlus();
      grantNote.textContent = grantText();
      toast(on ? 'Plus turned on' : 'Plus turned off');
    } catch (err) {
      toggle.checked = !on;
      toast(notAdmin(err) ? 'No admin access' : `Couldn’t save: ${err.message}`, 'bad');
    } finally {
      toggle.disabled = false;
    }
  });
  const grantText = () => u.plus_granted_at
    ? `${u.plus_granted ? 'Turned on' : 'Turned off'} ${ago(u.plus_granted_at)}${u.plus_granted_by ? ` by ${u.plus_granted_by}` : ''}.`
    : 'Never changed here.';
  const grantNote = el('p', { class: 'muted small' }, grantText());
  paintPlus();

  const paid = u.plan === 'plus' || u.paid_until || u.subscription_status;

  return [
    el('a', { href: '#/plans', class: 'back' }, '← Plans & access'),
    el('header', { class: 'page-head user-head' },
      avatar(u, 56),
      el('div', {},
        el('h1', {}, u.name || u.email || 'Unnamed user'),
        u.name ? el('p', { class: 'muted' }, u.email) : null),
      status),
    el('section', { class: 'card' },
      el('h2', {}, 'Plus'),
      el('div', { class: 'switch-row' },
        el('label', { for: 'plus-toggle' },
          el('span', { class: 'label' }, 'Give Plus'),
          el('span', { class: 'muted small' }, 'No feed limit. Independent of any paid subscription, which this doesn’t change.')),
        el('span', { class: 'switch' }, toggle, el('span', { class: 'track', 'aria-hidden': 'true' }))),
      grantNote,
      source),
    el('section', { class: 'card' },
      el('h2', {}, 'Account'),
      el('dl', { class: 'facts' },
        fact('Email', u.email ?? '—'),
        fact('Signed up', when(u.created_at)),
        fact('Last sign-in', when(u.last_sign_in_at), el('span', { class: 'muted' }, ` (${ago(u.last_sign_in_at)})`)),
        fact('Synced feeds', `${plural(u.feeds, 'feed', 'feeds')}, ${plural(u.accounts, 'account', 'accounts')}`),
        fact('Feeds last changed', when(u.feeds_updated_at)),
        fact('User ID', el('code', {}, u.id)))),
    el('section', { class: 'card' },
      el('h2', {}, 'Subscription'),
      paid
        ? el('dl', { class: 'facts' },
          fact('Plan', u.plan === 'plus' ? 'Plus' : 'Free'),
          fact('Paid until', day(u.paid_until)),
          fact('Status', u.subscription_status ?? '—'),
          fact('Cancels at period end', u.cancel_at_period_end ? 'Yes' : 'No'))
        : el('p', { class: 'muted' }, 'No paid subscription.'))];
}

// ---------- routing ----------

let renderId = 0;
async function render() {
  const id = ++renderId;
  if (!session) return signedOutView(render.error);
  const route = location.hash.match(/^#\/plans\/users\/([0-9a-f-]{36})$/i);
  if (!/^#\/plans(\/|$)/.test(location.hash)) { history.replaceState(null, '', '#/plans'); }
  try {
    if (!session.email) {
      const user = await call('/auth/v1/user', { token: await accessToken() });
      saveSession({ ...session, email: user.email ?? '' });
    }
    const nodes = await (route ? userView(route[1]) : plansView());
    if (id !== renderId) return;
    chrome_({ signedIn: true, admin: true });
    show(...nodes);
    main.focus({ preventScroll: true });
  } catch (err) {
    if (id !== renderId) return;
    if (!session) return signedOutView();
    if (notAdmin(err)) return notAdminView();
    chrome_({ signedIn: true, admin: false });
    errorView(err, render);
  }
}

$('#sign-out').addEventListener('click', signOut);
window.addEventListener('hashchange', () => {
  if (/access_token=|error=/.test(location.hash)) render.error = takeRedirect();
  scrollTo(0, 0);
  render();
});
render.error = takeRedirect();
render();
