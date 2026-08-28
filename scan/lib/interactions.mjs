/**
 * Element resolution for timespan steps.
 *
 * Every lookup asserts exactly one *visible* match. Reporting 0 ms because a
 * selector silently stopped matching is the failure mode that would quietly
 * invalidate the whole trend, so absence and ambiguity both throw.
 *
 * Visibility is part of the assertion rather than a nicety: the PDP renders two
 * `[data-testid="button-see-room"]` buttons, one of them collapsed to 0x0, so
 * matching on the selector alone is genuinely ambiguous.
 */

const RESOLVE_TIMEOUT_MS = 30_000;
const SETTLE_TIMEOUT_MS = 10_000;
const DISMISS_ATTEMPTS = 3;
const MARK_ATTR = 'data-cwv-scan-target';

/**
 * Tag every visible match with a temporary attribute and report how many there
 * were. This is the only browser-side matcher, polled from Node rather than
 * evaluated through `waitForFunction`, because reusing one definition across
 * both would mean `eval` inside the page and tiket.com's CSP forbids that.
 */
function markMatches(page, selector, text, attr) {
  return page.evaluate(
    (sel, expected, mark) => {
      for (const stale of document.querySelectorAll(`[${mark}]`)) {
        stale.removeAttribute(mark);
      }
      const matched = [...document.querySelectorAll(sel)]
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = getComputedStyle(el);
          return (
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            style.opacity !== '0'
          );
        })
        .filter((el) => expected == null || (el.textContent || '').trim() === expected);
      matched.forEach((el) => el.setAttribute(mark, ''));
      return matched.length;
    },
    selector,
    text,
    attr
  );
}

/** Poll until at least one visible match appears, or the timeout expires. */
async function findMatches(page, spec, timeoutMs) {
  const { selector, text = null } = spec;
  const deadline = Date.now() + timeoutMs;

  let count = 0;
  while (Date.now() < deadline) {
    count = await markMatches(page, selector, text, MARK_ATTR);
    if (count > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (count !== 1) return { count, handle: null };

  const handle = await page.$(`[${MARK_ATTR}]`);
  await page.evaluate(
    (attr) => document.querySelector(`[${attr}]`)?.removeAttribute(attr),
    MARK_ATTR
  );
  return { count, handle };
}

/**
 * Resolve the trigger element. Called before the timespan starts so that
 * polling, DOM queries and marking stay outside the measured window.
 *
 * @param {import('puppeteer').Page} page
 * @param {{selector: string, text?: string}} spec
 * @param {string} label
 */
export async function resolveUnique(page, spec, label) {
  const { count, handle } = await findMatches(page, spec, RESOLVE_TIMEOUT_MS);
  const describe =
    spec.text == null ? spec.selector : `${spec.selector} with exact text "${spec.text}"`;

  if (count === 0) {
    throw new Error(
      `${label}: no visible match for ${describe} within ${RESOLVE_TIMEOUT_MS}ms`
    );
  }
  if (count !== 1) {
    throw new Error(
      `${label}: expected exactly 1 visible match for ${describe}, got ${count}`
    );
  }
  return handle;
}

/**
 * Press an element the way a user on this form factor would.
 *
 * The mobile site binds touch handlers and ignores synthetic mouse clicks, and
 * a scripted `element.click()` is not a real user interaction, so Chrome's
 * Event Timing API would never record it and INP would come back as
 * not-applicable. Real input events are a hard requirement here.
 */
export async function press(page, handle) {
  if (page.viewport()?.hasTouch) await handle.tap();
  else await handle.click();
}

/**
 * Dismiss one overlay if it is present.
 *
 * Absence is not an error - the promos are campaign-driven and may simply not
 * run some week - but failing to close one that *is* present must be loud,
 * since every subsequent tap would land on it instead of the target.
 *
 * @returns {Promise<boolean>} whether the overlay was there and got dismissed
 */
export async function dismissOverlay(page, spec, label) {
  const found = await findMatches(page, spec.dismiss, spec.timeoutMs);
  if (found.count === 0) return false;
  if (found.count > 1) {
    throw new Error(
      `${label}: ${spec.name} dismiss control matched ${found.count} elements, expected 1`
    );
  }

  // These overlays animate in and out, and a press aimed at an element that is
  // still sliding lands on empty space, so wait for it to hold still and retry
  // rather than trusting a single press.
  for (let attempt = 1; attempt <= DISMISS_ATTEMPTS; attempt++) {
    const { count, handle } =
      attempt === 1 ? found : await findMatches(page, spec.dismiss, 1000);
    if (count === 0) break;

    await waitForStableBox(handle);
    await press(page, handle);
    if (await isGone(page, spec.container)) return true;
  }

  if (await isGone(page, spec.container)) return true;
  throw new Error(
    `${label}: pressed ${spec.name}'s dismiss control ${DISMISS_ATTEMPTS} times but ` +
      `"${spec.container}" is still in the DOM`
  );
}

/** Poll the box until two consecutive reads agree, so the element has settled. */
async function waitForStableBox(handle, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let previous = null;
  while (Date.now() < deadline) {
    const box = await handle.boundingBox();
    if (box && previous && box.x === previous.x && box.y === previous.y) return;
    previous = box;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function isGone(page, selector, timeoutMs = 2500) {
  return page
    .waitForFunction((sel) => document.querySelector(sel) == null, { timeout: timeoutMs }, selector)
    .then(() => true)
    .catch(() => false);
}

/** @returns {Promise<string[]>} names of the overlays that were present */
export async function dismissOverlays(page, specs, label) {
  const dismissed = [];
  for (const spec of specs) {
    if (await dismissOverlay(page, spec, label)) dismissed.push(spec.name);
  }
  return dismissed;
}

/**
 * Wait for the interaction's visible result.
 *
 * `selector` waits for an element to become visible - right for the bottom
 * sheets, which mount on demand. `inViewport` waits for an element that is
 * already in the DOM to be scrolled into view, which is what the PDP's
 * "See rooms" button actually does.
 */
export async function waitForSettle(page, spec, label) {
  if (!spec) return;

  if (spec.selector) {
    try {
      await page.waitForSelector(spec.selector, {
        timeout: SETTLE_TIMEOUT_MS,
        visible: true,
      });
    } catch {
      throw new Error(
        `${label}: clicked the trigger but "${spec.selector}" never became visible`
      );
    }
    return;
  }

  if (spec.inViewport) {
    try {
      await page.waitForFunction(
        (sel) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          return rect.top < window.innerHeight && rect.bottom > 0;
        },
        { timeout: SETTLE_TIMEOUT_MS, polling: 'raf' },
        spec.inViewport
      );
    } catch {
      throw new Error(
        `${label}: clicked the trigger but "${spec.inViewport}" never scrolled into view`
      );
    }
  }
}

/** Count product cards as run context; missing selectors count as zero. */
export async function countCards(page, selectors) {
  return page.evaluate(
    (sels) =>
      sels.reduce((total, sel) => total + document.querySelectorAll(sel).length, 0),
    selectors
  );
}
