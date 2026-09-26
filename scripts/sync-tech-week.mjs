#!/usr/bin/env node
/**
 * Refresh techlist.cleaned.json from live Tech Week calendars (SF + LA)
 * using Playwright Chromium headless (channel: 'chrome') and in-page
 * tRPC enumeration for topics/types. Builds catalog primarily from API.
 *
 * Outputs:
 * - Writes a candidate catalog to /workspace/techlist.cleaned.new.json
 * - Writes a run summary to /workspace/scripts/sync-report.json
 * - Prints a concise JSON summary to stdout for caller consumption
 *
 * This script does NOT commit. Upstream automation decides whether to
 * replace techlist.cleaned.json based on meaningful diffs.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const CURRENT_JSON = path.join(ROOT, 'techlist.cleaned.json');
const CANDIDATE_JSON = path.join(ROOT, 'techlist.cleaned.new.json');
const RUN_REPORT = path.join(__dirname, 'sync-report.json');
const LOG_PATH = path.join(__dirname, 'sync-run.log');

const CITIES = ['sf', 'la'];
const PER_PAGE_DEFAULT = 48;
const THROTTLE_MS = 300;

const THEME_SLUGS = {
  'AI': 'ai',
  'AR / VR': 'ar-vr',
  'B2B': 'b2b',
  'B2C / Consumer': 'b2c-consumer',
  'Climate': 'climate',
  'Creators': 'creators',
  'Crypto / Web3': 'crypto-web3',
  'Cybersecurity': 'cybersecurity',
  'Deep Tech': 'deep-tech',
  'Defense': 'defense',
  'Engineering': 'engineering',
  'Fintech': 'fintech',
  'Fundraising / Investing': 'fundraising-investing',
  'Gaming': 'gaming',
  'GTM': 'gtm',
  'Hardware': 'hardware',
  'Healthcare / Healthtech': 'healthcare-healthtech',
  'HR / Hiring': 'hr-hiring',
  'Infrastructure': 'infrastructure',
  'International / Expansion': 'international-expansion',
  'Media / Entertainment': 'media-entertainment',
  'SaaS': 'saas',
  'Women-focused': 'women-focused',
};
const FORMAT_SLUGS = {
  'Breakfast, Brunch or Lunch': 'breakfast-brunch-or-lunch',
  'Dinner': 'dinner',
  'Experiential': 'experiential',
  'Hackathon': 'hackathon',
  'Happy Hour': 'happy-hour',
  'Matchmaking': 'matchmaking',
  'Networking': 'networking',
  'Panel / Fireside Chat': 'panel-fireside-chat',
  'Pitch Event / Demo Day': 'pitch-event-demo-day',
  'Roundtable / Workshop': 'roundtable-workshop',
};

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_PATH, line + '\n', 'utf8');
  } catch {}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatTime(t) {
  if (!t || typeof t !== 'string') return '';
  const [hh, mm] = t.split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return t;
  const ampm = hh >= 12 ? 'pm' : 'am';
  let h = hh % 12;
  if (h === 0) h = 12;
  return `${h}:${String(mm).padStart(2, '0')}${ampm}`;
}

function formatDate(d) {
  // API: "2026-10-05" -> catalog: "Monday, Oct 5"
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[dt.getDay()]}, ${months[dt.getMonth()]} ${dt.getDate()}`;
}

function absHref(href) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  return `https://www.tech-week.com${href}`;
}

function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function identityKey(city, date_label, start_time_display, title, host, neighborhood) {
  return [city, date_label, start_time_display, title, host, neighborhood].map(norm).join('|');
}

function fuzzyKey(city, title, host, date_label) {
  return [city, title, host, date_label].map(norm).join('|');
}

function buildLabels(apiEv) {
  const labels = [];
  if (apiEv?.isFeatured) labels.push('Featured');
  const rs = String(apiEv?.registrationStatus || '').toLowerCase();
  if (rs.includes('closed')) labels.push('Closed');
  return labels;
}

function buildHostString(apiEv) {
  // Prefer company, but include cohosts from facets.hosts when present.
  const names = [];
  const primary = (apiEv?.company || '').trim();
  if (primary) names.push(primary);
  const hosts = apiEv?.facets?.hosts || apiEv?.hosts || [];
  const addName = (name) => {
    const n = String(name || '').trim();
    if (!n) return;
    if (!names.includes(n)) names.push(n);
  };
  if (Array.isArray(hosts)) {
    for (const h of hosts) {
      if (typeof h === 'string') addName(h);
      else if (h && typeof h === 'object') addName(h.label || h.name || h.title);
    }
  }
  return names.join(', ');
}

function primaryHost(host) {
  return (host || '').split(',')[0].trim();
}

function sortKey(apiEv) {
  // Sort by date, then time, then title (case-insensitive)
  return [
    apiEv?.date || '',
    apiEv?.time || '',
    (apiEv?.name || '').toLowerCase(),
    (apiEv?.company || '').toLowerCase(),
  ].join('|');
}

function newCandidateEventFromApi(city, apiEv) {
  const host = buildHostString(apiEv);
  return {
    date_label: formatDate(apiEv?.date || ''),
    start_time_display: formatTime(apiEv?.time || ''),
    title: apiEv?.name || '',
    host,
    neighborhood: apiEv?.location || '',
    labels: buildLabels(apiEv),
    event_url: absHref(apiEv?.externalHref || ''),
    // source_row: to be assigned after sorting
    city,
    topics: [], // filled after enumeration
    types: [], // filled after enumeration
  };
}

async function fetchTrpcBatch(page, body) {
  return page.evaluate(async (b) => {
    async function postOnce() {
      try {
        const res = await fetch('/api/trpc/calendar.events?batch=1', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ '0': b }),
        });
        const text = await res.text();
        return { status: res.status, text, method: 'POST' };
      } catch (e) {
        return { status: 0, text: String(e), method: 'POST' };
      }
    }
    async function getOnce() {
      try {
        const q = encodeURIComponent(JSON.stringify({ '0': b }));
        const res = await fetch(`/api/trpc/calendar.events?batch=1&input=${q}`, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { 'accept': 'application/json' },
        });
        const text = await res.text();
        return { status: res.status, text, method: 'GET' };
      } catch (e) {
        return { status: 0, text: String(e), method: 'GET' };
      }
    }
    // Try POST, then GET fallback if not 200
    const first = await postOnce();
    if (first.status === 200) return first;
    const second = await getOnce();
    if (second.status === 200) return second;
    // Return the better of two attempts (prefer one with nonzero status)
    return first.status ? first : second;
  }, body);
}

function makeBody(city, theme, format, cursor) {
  return {
    city,
    q: '',
    featured: false,
    day: 'all',
    track: [],
    sponsor: [],
    theme: theme ? [theme] : [],
    format: format ? [format] : [],
    location: [],
    time: [],
    host: [],
    sortBy: 'time',
    sortOrder: 'asc',
    cursor,
    direction: 'forward',
  };
}

async function enumerate(page, city, kind, slug, label, run) {
  const theme = kind === 'theme' ? slug : null;
  const format = kind === 'format' ? slug : null;
  const tag = kind === 'baseline' ? 'baseline' : `${kind}:${slug}`;

  let cursor = 1;
  let total = 0;
  let perPage = PER_PAGE_DEFAULT;
  let pagesFetched = 0;
  const accum = [];
  const errors = [];

  // First page with retry
  let resp;
  try {
    resp = await fetchTrpcBatch(page, makeBody(city, theme, format, cursor));
  } catch (e) {
    errors.push({ cursor, error: String(e) });
    await sleep(1000);
    try {
      resp = await fetchTrpcBatch(page, makeBody(city, theme, format, cursor));
    } catch (e2) {
      errors.push({ cursor, error: `retry: ${e2}` });
      return { tag, city, kind, slug, label, total: 0, collected: 0, pagesFetched: 0, events: [], errors };
    }
  }
  if (resp.status !== 200) {
    errors.push({ cursor, status: resp.status, snippet: resp.text.slice(0, 160) });
    await sleep(1500);
    try {
      resp = await fetchTrpcBatch(page, makeBody(city, theme, format, cursor));
    } catch (e) {
      errors.push({ cursor, error: `retry: ${e}` });
      return { tag, city, kind, slug, label, total: 0, collected: 0, pagesFetched: 0, events: [], errors };
    }
    if (resp.status !== 200) {
      errors.push({ cursor, status: resp.status, after_retry: true, snippet: resp.text.slice(0, 160) });
      return { tag, city, kind, slug, label, total: 0, collected: 0, pagesFetched: 0, events: [], errors };
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(resp.text);
  } catch (e) {
    errors.push({ cursor, error: `json: ${e}`, snippet: resp.text.slice(0, 200) });
    return { tag, city, kind, slug, label, total: 0, collected: 0, pagesFetched: 0, events: [], errors };
  }
  const data = parsed?.[0]?.result?.data;
  if (!data) {
    errors.push({ cursor, error: 'missing result.data', snippet: resp.text.slice(0, 200) });
    return { tag, city, kind, slug, label, total: 0, collected: 0, pagesFetched: 0, events: [], errors };
  }

  total = data.total;
  perPage = data.perPage || PER_PAGE_DEFAULT;
  accum.push(...(data.results || []));
  pagesFetched = 1;
  const lastCursor = Math.max(1, Math.ceil(total / perPage));
  log(`  [${city}] ${tag} total=${total} pages=${lastCursor}`);

  for (cursor = 2; cursor <= lastCursor; cursor++) {
    await sleep(THROTTLE_MS);
    let pageResp;
    try {
      pageResp = await fetchTrpcBatch(page, makeBody(city, theme, format, cursor));
    } catch (e) {
      errors.push({ cursor, error: String(e) });
      await sleep(1000);
      try {
        pageResp = await fetchTrpcBatch(page, makeBody(city, theme, format, cursor));
      } catch (e2) {
        errors.push({ cursor, error: `retry: ${e2}` });
        continue;
      }
    }
    if (pageResp.status !== 200) {
      errors.push({ cursor, status: pageResp.status, snippet: pageResp.text.slice(0, 140) });
      await sleep(1500);
      try {
        pageResp = await fetchTrpcBatch(page, makeBody(city, theme, format, cursor));
      } catch (e) {
        errors.push({ cursor, error: `retry: ${e}` });
        continue;
      }
      if (pageResp.status !== 200) {
        errors.push({ cursor, status: pageResp.status, after_retry: true });
        continue;
      }
    }
    let p;
    try {
      p = JSON.parse(pageResp.text);
    } catch (e) {
      errors.push({ cursor, error: `json: ${e}` });
      continue;
    }
    const d = p?.[0]?.result?.data;
    if (!d) {
      errors.push({ cursor, error: 'missing result.data' });
      continue;
    }
    accum.push(...(d.results || []));
    pagesFetched++;
    if (cursor % 5 === 0 || cursor === lastCursor) {
      log(`  [${city}] ${tag} page ${cursor}/${lastCursor} collected=${accum.length}`);
    }
  }

  // Dedupe by id
  const byId = new Map();
  for (const e of accum) if (e?.id) byId.set(e.id, e);
  return {
    tag, city, kind, slug, label,
    total, collected: byId.size, pagesFetched,
    events: [...byId.values()],
    errors,
  };
}

function unionTags(record, topicLabel, typeLabel) {
  if (topicLabel) record.topics.add(topicLabel);
  if (typeLabel) record.types.add(typeLabel);
}

function toOutputEvent(city, rec) {
  return {
    ...rec.baseEvent,
    source_row: rec.source_row, // assigned later
    city,
    topics: [...rec.topics].sort(),
    types: [...rec.types].sort(),
  };
}

function computeDiffMetrics(before, after) {
  // Build identity maps
  const keyOf = (e) => identityKey(e.city, e.date_label, e.start_time_display, e.title, e.host, e.neighborhood);
  const mapByKey = (arr) => {
    const m = new Map();
    for (const e of arr) m.set(keyOf(e), e);
    return m;
  };
  const bMap = mapByKey(before.events || []);
  const aMap = mapByKey(after.events || []);
  const bKeys = new Set(bMap.keys());
  const aKeys = new Set(aMap.keys());

  const added = [...aKeys].filter((k) => !bKeys.has(k));
  const removed = [...bKeys].filter((k) => !aKeys.has(k));
  let urlRefresh = 0;
  let labelChanges = 0;
  let topicChanges = 0;
  let typeChanges = 0;
  let fieldChanges = 0; // any non-URL field diff among matched identities

  const intersect = [...aKeys].filter((k) => bKeys.has(k));
  for (const k of intersect) {
    const be = bMap.get(k);
    const ae = aMap.get(k);
    if ((be.event_url || '') !== (ae.event_url || '')) urlRefresh++;
    const eqLabels = JSON.stringify([...new Set(be.labels || [])]) === JSON.stringify([...new Set(ae.labels || [])]);
    if (!eqLabels) labelChanges++;
    const eqTopics = JSON.stringify((be.topics || []).slice().sort()) === JSON.stringify((ae.topics || []).slice().sort());
    if (!eqTopics) topicChanges++;
    const eqTypes = JSON.stringify((be.types || []).slice().sort()) === JSON.stringify((ae.types || []).slice().sort());
    if (!eqTypes) typeChanges++;
    const nonUrlFieldsSame =
      be.date_label === ae.date_label &&
      be.start_time_display === ae.start_time_display &&
      be.title === ae.title &&
      be.host === ae.host &&
      be.neighborhood === ae.neighborhood &&
      eqLabels &&
      eqTopics &&
      eqTypes;
    if (!nonUrlFieldsSame) fieldChanges++;
  }

  const meaningful =
    added.length > 0 ||
    removed.length > 0 ||
    fieldChanges > 0; // topics/types/labels/title/host/time/etc.

  return {
    identity_added: added.length,
    identity_removed: removed.length,
    url_refresh: urlRefresh,
    label_changes: labelChanges,
    topic_changes: topicChanges,
    type_changes: typeChanges,
    field_changes: fieldChanges,
    meaningful_changes: meaningful,
    notable_removed_titles: removed.slice(0, 5).map((k) => (bMap.get(k)?.title || '')),
  };
}

function computeEnrichmentMatchBreakdown(beforeEvents, afterEvents) {
  // Attempt to match previous catalog events against new catalog for method breakdown
  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function keyExact(e) { return [e.city, e.date_label, e.start_time_display, e.title, e.host, e.neighborhood].map(norm).join('|'); }
  function keyPrimary(e) { return [e.city, e.date_label, e.start_time_display, e.title, primaryHost(e.host), e.neighborhood].map(norm).join('|'); }
  function keyFuzzy(e) { return [e.city, e.title, primaryHost(e.host), e.date_label].map(norm).join('|'); }
  function keyTDT(e) { return [e.city, e.date_label, e.start_time_display, norm(e.title)].join('|'); }

  const byExact = new Map();
  const byPrimary = new Map();
  const byFuzzy = new Map();
  const byTDT = new Map();
  for (const e of afterEvents) {
    const ex = keyExact(e); if (!byExact.has(ex)) byExact.set(ex, []); byExact.get(ex).push(e);
    const pr = keyPrimary(e); if (!byPrimary.has(pr)) byPrimary.set(pr, []); byPrimary.get(pr).push(e);
    const fu = keyFuzzy(e); if (!byFuzzy.has(fu)) byFuzzy.set(fu, []); byFuzzy.get(fu).push(e);
    const td = keyTDT(e); if (!byTDT.has(td)) byTDT.set(td, []); byTDT.get(td).push(e);
  }
  let matchedExact = 0, matchedPrimary = 0, matchedFuzzy = 0, matchedTDT = 0, unmatched = 0;
  for (const e of beforeEvents) {
    if (byExact.has(keyExact(e))) matchedExact++;
    else if (byPrimary.has(keyPrimary(e))) matchedPrimary++;
    else if (byFuzzy.has(keyFuzzy(e))) matchedFuzzy++;
    else if (byTDT.has(keyTDT(e))) matchedTDT++;
    else unmatched++;
  }
  return { exact: matchedExact, primary_host: matchedPrimary, fuzzy: matchedFuzzy, title_date_time: matchedTDT, unmatched };
}

async function main() {
  fs.writeFileSync(LOG_PATH, '', 'utf8');
  const startedAt = new Date().toISOString();
  const before = JSON.parse(fs.readFileSync(CURRENT_JSON, 'utf8'));

  // --- DOM fallback helpers ---
  async function scrollToLoadAll(page) {
    let prev = 0;
    let stable = 0;
    for (let i = 0; i < 120; i++) {
      const count = await page.evaluate(() => {
        const titleNodes = Array.from(document.querySelectorAll('a.event-title, a[data-ga-event-title]'));
        return titleNodes.length;
      });
      if (count <= prev) stable++; else stable = 0;
      prev = count;
      if (stable >= 3) break;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
    }
  }
  function toAbs(href) {
    if (!href) return '';
    if (href.startsWith('http')) return href;
    return `https://www.tech-week.com${href}`;
  }
  async function extractDomEvents(page, city) {
    const rows = await page.evaluate(() => {
      function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
      const datePattern = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), [A-Z][a-z]{2} \d{1,2}$/;
      const out = [];
      let dateLabel = null;
      const trs = Array.from(document.querySelectorAll('tr'));
      for (const tr of trs) {
        const tds = Array.from(tr.querySelectorAll(':scope > td'));
        if (tds.length === 1 && datePattern.test(clean(tds[0].textContent || ''))) {
          dateLabel = clean(tds[0].textContent || '');
          continue;
        }
        if (!dateLabel || tds.length !== 5) continue;
        const a = tr.querySelector('a[href*="/go/event/"]');
        const titleNode = tr.querySelector('.event-title, [data-ga-event-title]');
        const timeText = clean((tds[0].textContent || '').replace(/·$/, '').trim());
        const hostNode = tds[2].querySelector('span');
        const neighborhood = clean(tds[3].textContent || '');
        if (!a || !titleNode || !hostNode || !timeText) continue;
        const labels = Array.from(tds[1].querySelectorAll('[data-slot="badge"]')).map((n) => clean(n.textContent || ''));
        out.push({
          date_label: dateLabel,
          start_time_display: timeText,
          title: clean(titleNode.textContent || ''),
          host: clean(hostNode.textContent || ''),
          neighborhood,
          labels: Array.from(new Set(labels)),
          event_url: a.getAttribute('href') || '',
        });
      }
      return out;
    });
    // Absolutize URLs and tag city
    return rows.map((e, idx) => ({
      ...e,
      event_url: toAbs(e.event_url),
      source_row: idx + 1, // reassigned later after ordering
      city,
      topics: [],
      types: [],
    }));
  }
  function idKeyOf(e) {
    return identityKey(e.city, e.date_label, e.start_time_display, e.title, e.host, e.neighborhood);
  }

  let launchMode = 'chrome';
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--disable-dev-shm-usage', '--no-sandbox'] });
  } catch (e) {
    log('Chrome channel launch failed, falling back to bundled Chromium:', e.message || e);
    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox'] });
    launchMode = 'chromium';
  }
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.setDefaultTimeout(180000);

  // Establish cookies/session
  log('Opening SF calendar...');
  await page.goto('https://www.tech-week.com/calendar/sf', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForTimeout(4000);
  try {
    const btn = page.locator('button:has-text("Accept"), button:has-text("Got it"), button:has-text("OK")').first();
    if (await btn.isVisible({ timeout: 1500 })) await btn.click({ timeout: 2000 });
  } catch {}

  const run = {
    started_at: startedAt,
    browser_channel: launchMode,
    enumeration_error_count: 0,
    cities: { sf: { baseline_total: 0, unique_ids: 0 }, la: { baseline_total: 0, unique_ids: 0 } },
    enumerations: [],
    errors: [],
  };

  // State across cities
  const byId = new Map(); // id -> { city, baseEvent, topics:Set, types:Set }
  let usedDomFallback = false;

  for (const city of CITIES) {
    if (city !== 'sf') {
      log(`Opening ${city} calendar...`);
      await page.goto(`https://www.tech-week.com/calendar/${city}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
      await page.waitForTimeout(3000);
    }

    // 1) Baseline
    log(`[${city}] baseline enumeration`);
    const base = await enumerate(page, city, 'baseline', null, null, run);
    run.cities[city].baseline_total = base.total;
    run.enumerations.push({ city, kind: 'baseline', total: base.total, collected: base.collected, pages: base.pagesFetched, errors: base.errors.length });
    if (base.errors.length) {
      run.errors.push({ city, tag: 'baseline', errors: base.errors });
      run.enumeration_error_count += base.errors.length;
    }
    if (base.collected > 0) {
      for (const apiEv of base.events) {
        if (!apiEv?.id) continue;
        const rec = byId.get(apiEv.id) || {
          city,
          baseEvent: newCandidateEventFromApi(city, apiEv),
          topics: new Set(),
          types: new Set(),
          source_row: 0,
        };
        byId.set(apiEv.id, rec);
      }
      run.cities[city].unique_ids = [...byId.values()].filter((r) => r.city === city).length;
    } else {
      usedDomFallback = true;
      log(`[${city}] tRPC baseline unavailable — falling back to DOM scrape`);
      await scrollToLoadAll(page);
      const domEvents = await extractDomEvents(page, city);
      if (!run.dom) run.dom = { sf: [], la: [] };
      run.dom[city] = domEvents;
      run.cities[city].unique_ids = domEvents.length;
    }

    // 2) Themes
    for (const [label, slug] of Object.entries(THEME_SLUGS)) {
      await sleep(THROTTLE_MS);
      if (!usedDomFallback) {
        const res = await enumerate(page, city, 'theme', slug, label, run);
        run.enumerations.push({ city, kind: 'theme', slug, label, total: res.total, collected: res.collected, pages: res.pagesFetched, errors: res.errors.length });
        if (res.errors.length) {
          run.errors.push({ city, tag: `theme:${slug}`, errors: res.errors });
          run.enumeration_error_count += res.errors.length;
        }
        for (const apiEv of res.events) {
          const rec = byId.get(apiEv.id);
          if (!rec) continue; // not in baseline (shouldn't happen, but safe)
          unionTags(rec, label, null);
        }
      } else {
        await page.goto(`https://www.tech-week.com/calendar/${city}?theme=${encodeURIComponent(slug)}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
        await page.waitForTimeout(1000);
        await scrollToLoadAll(page);
        const filtered = await extractDomEvents(page, city);
        const present = new Set(filtered.map(idKeyOf));
        const baseList = run.dom?.[city] || [];
        for (const ev of baseList) {
          if (present.has(idKeyOf(ev))) {
            ev.topics = Array.from(new Set([...(ev.topics || []), label]));
          }
        }
      }
    }

    // 3) Formats
    for (const [label, slug] of Object.entries(FORMAT_SLUGS)) {
      await sleep(THROTTLE_MS);
      if (!usedDomFallback) {
        const res = await enumerate(page, city, 'format', slug, label, run);
        run.enumerations.push({ city, kind: 'format', slug, label, total: res.total, collected: res.collected, pages: res.pagesFetched, errors: res.errors.length });
        if (res.errors.length) {
          run.errors.push({ city, tag: `format:${slug}`, errors: res.errors });
          run.enumeration_error_count += res.errors.length;
        }
        for (const apiEv of res.events) {
          const rec = byId.get(apiEv.id);
          if (!rec) continue;
          unionTags(rec, null, label);
        }
      } else {
        await page.goto(`https://www.tech-week.com/calendar/${city}?format=${encodeURIComponent(slug)}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
        await page.waitForTimeout(1000);
        await scrollToLoadAll(page);
        const filtered = await extractDomEvents(page, city);
        const present = new Set(filtered.map(idKeyOf));
        const baseList = run.dom?.[city] || [];
        for (const ev of baseList) {
          if (present.has(idKeyOf(ev))) {
            ev.types = Array.from(new Set([...(ev.types || []), label]));
          }
        }
      }
    }
  }

  await browser.close();

  // Build ordered output: SF first, then LA
  let events = [];
  if (!usedDomFallback) {
    const sf = [];
    const la = [];
    for (const [id, rec] of byId) {
      const arr = rec.city === 'la' ? la : sf;
      arr.push({ id, rec });
    }
    const sortTuple = (r) => [
      r.rec.baseEvent.date_label,
      r.rec.baseEvent.start_time_display,
      r.rec.baseEvent.title.toLowerCase(),
      r.rec.baseEvent.host.toLowerCase(),
    ].join('|');
    sf.sort((a, b) => sortTuple(a).localeCompare(sortTuple(b)));
    la.sort((a, b) => sortTuple(a).localeCompare(sortTuple(b)));
    let rowNum = 1;
    for (const { rec } of sf) {
      rec.source_row = rowNum++;
      events.push(toOutputEvent('sf', rec));
    }
    for (const { rec } of la) {
      rec.source_row = rowNum++;
      events.push(toOutputEvent('la', rec));
    }
  } else {
    // Use DOM-fallback results, preserving SF then LA order and reassigned source_row
    const sfDom = (run.dom?.sf || []).slice();
    const laDom = (run.dom?.la || []).slice();
    const sortDom = (e) => [
      e.date_label,
      e.start_time_display,
      e.title.toLowerCase(),
      e.host.toLowerCase(),
    ].join('|');
    sfDom.sort((a, b) => sortDom(a).localeCompare(sortDom(b)));
    laDom.sort((a, b) => sortDom(a).localeCompare(sortDom(b)));
    let rowNum = 1;
    for (const e of sfDom) { e.source_row = rowNum++; events.push(e); }
    for (const e of laDom) { e.source_row = rowNum++; events.push(e); }
  }

  // Compose candidate catalog
  const snapshot_generated_at = new Date().toISOString();
  const candidate = {
    ...before,
    source_file: 'live:sf+la',
    snapshot_generated_at,
    // preserve notes, append if missing the enrichment note
  };
  const enrichmentNote =
    'topics[] and types[] are official Tech Week chip memberships from tRPC calendar.events filter enumeration (theme/format). Joined by identity (city+date_label+start_time_display+title+host+neighborhood); catalog multi-host strings match API owner via primary-host fallback.';
  const notes = Array.isArray(before.notes) ? [...before.notes] : [];
  if (!notes.some((n) => n.includes('topics[] and types[] are official Tech Week chip memberships'))) {
    notes.push(enrichmentNote);
  }
  candidate.notes = notes;
  candidate.events = events;
  candidate.event_count = events.length;
  candidate.source_event_rows = events.length;
  candidate.exact_duplicates_removed = 0;

  fs.writeFileSync(CANDIDATE_JSON, JSON.stringify(candidate, null, 2) + '\n', 'utf8');

  // Compute metrics vs previous
  const diff = computeDiffMetrics(before, candidate);
  const breakdown = computeEnrichmentMatchBreakdown(before.events || [], candidate.events || []);
  const sfCount = candidate.events.filter((e) => e.city === 'sf').length;
  const laCount = candidate.events.filter((e) => e.city === 'la').length;

  const summary = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    browser_channel: launchMode,
    enumeration_error_count: run.enumeration_error_count,
    dom_fallback_used: usedDomFallback,
    snapshot_generated_at,
    counts: { sf: sfCount, la: laCount, total: candidate.event_count },
    diff,
    enrichment_match_breakdown: breakdown,
    candidate_json: path.basename(CANDIDATE_JSON),
  };
  fs.writeFileSync(RUN_REPORT, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  try { fs.appendFileSync(LOG_PATH, `FATAL ${e.stack || e}\n`, 'utf8'); } catch {}
  process.exit(1);
});

