/**
 * Run context capture.
 *
 * A metric chart on its own cannot distinguish a code regression from a content
 * change. Promo presence alone once moved mobile CLS from 0.02 to 0.39 on this
 * site, so every run records what the page actually contained.
 */

import { PAGE_MODULES_PATTERN, PROMO_PATTERN } from '../targets.mjs';

export function attachContextCapture(page, { searchApiPattern = null } = {}) {
  /** @type {{url: string, durationMs: number|null, status: number|null}[]} */
  const xhr = [];
  const pending = [];
  let pageModulesBody = null;

  page.on('requestfinished', (request) => {
    const type = request.resourceType();
    if (type !== 'xhr' && type !== 'fetch') return;

    const response = request.response();
    let durationMs = null;
    try {
      const timing = response?.timing();
      // All ResourceTiming fields are ms offsets from requestTime, so
      // receiveHeadersEnd is request start -> response headers received.
      if (timing && timing.receiveHeadersEnd >= 0) {
        durationMs = Math.round(timing.receiveHeadersEnd);
      }
    } catch {
      // Timing is unavailable for cached and data-URL responses.
    }

    xhr.push({
      url: shortenUrl(request.url()),
      durationMs,
      status: response?.status() ?? null,
    });
  });

  page.on('response', (response) => {
    if (!PAGE_MODULES_PATTERN.test(response.url())) return;
    // Bodies must be read before the page navigates away, so start now and
    // await the queue at collection time.
    pending.push(
      response
        .text()
        .then((text) => {
          pageModulesBody = text;
        })
        .catch(() => {})
    );
  });

  return {
    async collect() {
      await Promise.all(pending);

      // The SRP fires the search endpoint more than once, so take the slowest
      // match rather than the first: the slow one is what LCP is waiting on.
      const searchMatches = searchApiPattern
        ? xhr.filter(
            (entry) => searchApiPattern.test(entry.url) && entry.durationMs != null
          )
        : [];
      const searchApi =
        searchMatches.sort((a, b) => b.durationMs - a.durationMs)[0] ?? null;

      return {
        searchApiMs: searchApi?.durationMs ?? null,
        searchApiUrl: searchApi?.url ?? null,
        searchApiCalls: searchMatches.length,
        // If the searchApi pattern ever stops matching, these make it obvious
        // what to point it at without having to re-run the scan.
        slowestXhr: [...xhr]
          .filter((entry) => entry.durationMs != null)
          .sort((a, b) => b.durationMs - a.durationMs)
          .slice(0, 3),
        xhrCount: xhr.length,
        ...parsePageModules(pageModulesBody),
      };
    },
  };
}

/**
 * The response is `{ data: [{ templateCode, sectionName, ... }] }` - the
 * landing page returns 17 of these, the SRP one. Only the codes are kept; the
 * bodies run to 250 KB and none of it explains a metric.
 */
function parsePageModules(body) {
  if (!body) return { pageModules: null, hasPromo: null };

  let modules;
  try {
    modules = JSON.parse(body)?.data;
  } catch {
    return { pageModules: null, hasPromo: null };
  }
  if (!Array.isArray(modules)) return { pageModules: null, hasPromo: null };

  const codes = [
    ...new Set(
      modules
        .map((module) => module?.templateCode ?? module?.sectionName)
        .filter((code) => typeof code === 'string')
    ),
  ].sort();

  return { pageModules: codes, hasPromo: codes.some((code) => PROMO_PATTERN.test(code)) };
}

/** Query strings carry session ids and timestamps that would churn every run. */
function shortenUrl(url) {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname}`;
  } catch {
    return url;
  }
}
