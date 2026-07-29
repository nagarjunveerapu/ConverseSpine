/**
 * Playwright UI soak for Phase 0d on Advisor dig (same spine URL).
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   node scripts/playwright-0d-advisor.mjs
 */
import { chromium } from 'playwright';

const ADVISOR = (
  process.env.ADVISOR_URL ?? 'https://naya-advisor-dev.pages.dev'
).replace(/\/+$/, '');

async function waitBotSettled(page) {
  await page.waitForTimeout(600);
  for (let i = 0; i < 80; i++) {
    const loading =
      (await page.locator('.na-ar-working, .na-typing').count()) +
      (await page.getByText(/pulling/i).count());
    const busy = await page.locator('[aria-busy="true"]').count();
    if (loading === 0 && busy === 0) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(500);
}

async function clickIfVisible(page, name, { exact = true, timeout = 12000 } = {}) {
  const btn = exact
    ? page.getByRole('button', { name, exact: true })
    : page.getByRole('button', { name });
  try {
    await btn.first().waitFor({ state: 'visible', timeout });
    await btn.first().click({ timeout: 5000 });
    await waitBotSettled(page);
    return true;
  } catch {
    return false;
  }
}

async function clickContinueIfReady(page) {
  const cont = page.getByRole('button', { name: 'Continue', exact: true });
  try {
    await cont.waitFor({ state: 'visible', timeout: 3000 });
    if (await cont.isEnabled()) {
      await cont.click();
      await waitBotSettled(page);
      return true;
    }
  } catch {
    /* no Continue this step */
  }
  return false;
}

async function waitComposerUnlocked(page, timeoutMs = 90000) {
  const input = page.locator(
    'input:not([disabled]), textarea:not([disabled]), input[placeholder*="Ask"], textarea[placeholder*="Ask"]',
  );
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const locked = page.getByPlaceholder(/Use the choices above/i);
    if ((await locked.count()) === 0) {
      const any = page.locator('.na-composer input, .na-composer textarea, textarea, input[type="text"]').first();
      if (await any.count()) {
        const dis = await any.isDisabled().catch(() => true);
        if (!dis) return any;
      }
    }
    // Keep advancing brief if still collecting
    await clickContinueIfReady(page);
    await page.waitForTimeout(500);
  }
  throw new Error('Composer still locked after brief timeout');
}

async function dismissBoardSheet(page) {
  // Matches hub opens "Your board" sheet over the composer on dig.
  const sheet = page.locator('[role="dialog"][aria-label="Your board"], .ot-sheet-on');
  if ((await sheet.count()) === 0) return;
  const close = sheet.getByRole('button', { name: /Close|Done|×/i }).first();
  if (await close.count()) {
    await close.click({ force: true }).catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(400);
}

async function sendText(page, text) {
  await dismissBoardSheet(page);
  const input = await waitComposerUnlocked(page, 15000);
  await input.click({ force: true }).catch(() => {});
  await input.fill(text);
  await input.press('Enter');
  await waitBotSettled(page);
}

async function lastBotText(page) {
  // Prefer last assistant bubble in chat column
  const candidates = [
    page.locator('.na-msg-bot, .na-bot-msg, [data-role="assistant"], .na-msg--bot'),
    page.locator('.na-chat-inner .na-msg').filter({ hasNot: page.locator('.na-msg-user, .na-user') }),
    page.locator('.na-chat-inner .na-msg'),
  ];
  for (const loc of candidates) {
    const n = await loc.count();
    if (n > 0) {
      const t = ((await loc.nth(n - 1).innerText()) || '').trim();
      if (t) return t;
    }
  }
  return ((await page.locator('body').innerText()) || '').slice(-800);
}

function pass(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function completeBrief(page) {
  // Purpose
  if (!(await clickIfVisible(page, 'Self-use'))) {
    await clickIfVisible(page, /Self-use/i, { exact: false });
  }

  // Budget
  if (!(await clickIfVisible(page, '₹50–70L'))) {
    await clickIfVisible(page, /50.?70/i, { exact: false });
  }

  // Property type + Continue
  if (!(await clickIfVisible(page, 'Apartment'))) {
    await clickIfVisible(page, /Apartment/i, { exact: false });
  }
  await clickContinueIfReady(page);

  // BHK + Continue
  if (!(await clickIfVisible(page, '2 BHK'))) {
    await clickIfVisible(page, /2 BHK/i, { exact: false });
  }
  await clickContinueIfReady(page);

  // Core: location → worries (+ Continue) → deepen: schools → hub
  const rest = [
    [/Aerospace Park|Devanahalli Corridor/i, 'living / corridor'],
    [/Resale value/i, 'worries'],
    [/Yes, factor them in/i, 'schools'],
    [/Whitefield \/ ITPL|Manyata \/ North|Not commute-driven/i, 'hub'],
  ];

  for (const [re, label] of rest) {
    const clicked = await clickIfVisible(page, re, { exact: false, timeout: 20000 });
    console.log(clicked ? `chip OK: ${label}` : `chip miss: ${label}`);
    await clickContinueIfReady(page);
    await waitBotSettled(page);
  }

  // Optional commute × area tension (dig UI)
  for (const label of ['About equal', 'Staying on budget', 'Shorter commute']) {
    if (await clickIfVisible(page, label, { exact: true, timeout: 4000 })) {
      console.log(`chip OK: tension (${label})`);
      break;
    }
  }

  // Shortlist / matches may auto-appear; wait for composer unlock
  console.log('waiting for brief → shortlist (composer unlock)…');
  await waitComposerUnlocked(page, 120000);
  await dismissBoardSheet(page);
  console.log('composer unlocked');
}

async function run() {
  console.log(`Playwright 0d → ${ADVISOR}/chat?fresh=1`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.goto(`${ADVISOR}/chat?fresh=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  await completeBrief(page);

  const body = await page.locator('body').innerText();
  console.log('board excerpt:', body.replace(/\s+/g, ' ').slice(0, 400));

  // Focus Eldorado
  const about = page.getByRole('button', { name: /Tell me about.*Eldorado|Eldorado/i });
  if (await about.count()) {
    await about.first().click();
    await waitBotSettled(page);
  } else {
    await sendText(page, 'Tell me about Brigade Eldorado');
  }

  const cases = [
    {
      ask: 'when is possession',
      ok: (t) => /possession|handover|ready|phase|202\d/i.test(t) && !/here'?s what fits|3 matches/i.test(t),
    },
    {
      ask: 'has this area appreciated',
      ok: (t) =>
        (/don'?t have|on file|trend|appreciat|value|won'?t put a number|can't verify|no .*data/i.test(t) ||
          /growth|cagr/i.test(t)) &&
        !/here'?s what fits|3 matches/i.test(t),
    },
    {
      ask: 'actually my budget is only 50L',
      ok: (t) => /₹|lakh|match|project|fit|budget|cornerstone|eldorado/i.test(t),
    },
  ];

  let passes = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    console.log(`\n--- UI: ${c.ask} ---`);
    await sendText(page, c.ask);
    const reply = await lastBotText(page);
    console.log(`reply: ${reply.slice(0, 360).replace(/\n/g, ' ')}`);
    const shot = `scripts/.0d-ui-${i}.png`;
    await page.screenshot({ path: shot, fullPage: false });
    if (pass(c.ok(reply), c.ask, shot)) passes += 1;
  }

  console.log(`\n=== Playwright UI ${passes}/${cases.length} ===`);
  await browser.close();
  process.exit(passes === cases.length ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
