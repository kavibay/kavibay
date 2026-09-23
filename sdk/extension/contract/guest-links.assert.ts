// SPDX-License-Identifier: MIT
/**
 * Checks for the guest intercept that turns an `<a href>` into `openExternal`.
 * Run: npx tsx sdk/extension/contract/guest-links.assert.ts
 *
 * The frame is `sandbox="allow-scripts"` with no navigation and no pop-ups, so
 * a generated widget that writes a link — the natural way to offer "open this
 * issue" — looks clickable and does nothing. The host already knows which
 * hosts a provider vouches for; this is the missing half that actually hands
 * the click over.
 */
import { httpsUrlToOpen, installLinkOpening } from "./sandbox-guest";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const assertEq = (actual: unknown, expected: unknown, msg: string) =>
  assert(
    Object.is(actual, expected),
    `${msg}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`,
  );

// --- which hrefs are a browser open, and which are left alone ---------------
{
  assertEq(
    httpsUrlToOpen("https://linear.app/acme/issue/ENG-12"),
    "https://linear.app/acme/issue/ENG-12",
    "a provider issue url is opened",
  );
  assertEq(
    httpsUrlToOpen("  https://linear.app/acme/issue/ENG-12  "),
    "https://linear.app/acme/issue/ENG-12",
    "surrounding space is not a reason to refuse",
  );
  assertEq(httpsUrlToOpen(""), null, "empty is a no-op");
  assertEq(httpsUrlToOpen("#details"), null, "in-page hashes stay in the page");
  assertEq(httpsUrlToOpen("http://linear.app/x"), null, "http is refused, not upgraded");
  assertEq(httpsUrlToOpen("javascript:alert(1)"), null, "javascript: is not a url to open");
  assertEq(httpsUrlToOpen("/issue/ENG-12"), null, "a relative path has no host to vouch for");
  assertEq(httpsUrlToOpen("linear.app/issue/ENG-12"), null, "a host without a scheme is not https");
}

function link(href: string) {
  return {
    getAttribute(name: string) {
      return name === "href" ? href : null;
    },
  };
}

function closestAnchor(href: string) {
  const a = link(href);
  return {
    closest(selector: string) {
      return selector === "a[href]" ? a : null;
    },
  };
}

function clickEvent(target: unknown) {
  let prevented = false;
  let stopped = false;
  return {
    target,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
    get prevented() {
      return prevented;
    },
    get stopped() {
      return stopped;
    },
  };
}

function harness() {
  const opened: string[] = [];
  const listeners: { type: string; capture: boolean; fire: (event: unknown) => void }[] = [];
  const target = {
    addEventListener(type: string, listener: (event: unknown) => void, capture?: boolean) {
      listeners.push({ type, capture: capture === true, fire: listener });
    },
    open: undefined as ((url?: string) => unknown) | undefined,
  };
  installLinkOpening(target, async (url) => {
    opened.push(url);
  });
  return {
    opened,
    target,
    click(event: unknown) {
      for (const entry of listeners) {
        if (entry.type === "click" && entry.capture) entry.fire(event);
      }
    },
  };
}

// --- a click on an <a href> is the open, not a navigation the sandbox kills --
{
  const h = harness();
  const event = clickEvent(closestAnchor("https://linear.app/acme/issue/ENG-12"));
  h.click(event);
  assertEq(h.opened.join(), "https://linear.app/acme/issue/ENG-12", "the href reached openExternal");
  assert(event.prevented, "the frame must not try to navigate itself");
  assert(event.stopped, "a widget click handler must not open the same url a second time");
}

// --- the words inside the link are what a person actually clicks ------------
{
  const h = harness();
  const event = clickEvent({ parentElement: closestAnchor("https://linear.app/acme/issue/ENG-12") });
  h.click(event);
  assertEq(h.opened.join(), "https://linear.app/acme/issue/ENG-12", "a text node inside the <a> still opens");
}

// --- a button, a hash, or a non-https href is not an open -------------------
{
  const h = harness();
  h.click(clickEvent({ closest: () => null }));
  h.click(clickEvent(closestAnchor("#more")));
  h.click(clickEvent(closestAnchor("http://example.com")));
  assertEq(h.opened.length, 0, "only https <a href> clicks are handed to the host");
}

// --- window.open is the other way a model writes "open this" ----------------
{
  const h = harness();
  assert(typeof h.target.open === "function", "window.open is replaced, not left as a silent no-op");
  h.target.open!("https://linear.app/acme/issue/ENG-12");
  assertEq(h.opened.join(), "https://linear.app/acme/issue/ENG-12", "window.open takes the same path as a click");
  h.target.open!("javascript:alert(1)");
  assertEq(h.opened.length, 1, "a non-https window.open is dropped rather than forwarded");
}

console.log("guest-links.assert.ts ok");
