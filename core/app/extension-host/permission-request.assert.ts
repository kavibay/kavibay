import { ExtensionRegistry } from "./registry";
import { buildPermissionRequest, grantFrom, askedNothingNew } from "./permissionRequest";
import { widgetPackageManifest } from "./widgetPackage";
import { tadoExtension } from "./fixtures/tado";

/**
 * Asserts for the approval dialog's decisions.
 * Run: npx tsx core/app/extension-host/permission-request.assert.ts
 *
 * The component renders this; it does not decide it. A dialog that looks right
 * and returns a grant nobody ticked is the failure worth guarding, and it is
 * exactly the sort a screenshot would not catch.
 *
 * What is decided here changed in FINDINGS §27: the question is now which
 * accounts a widget may use, not which queries. The separation it protects is
 * unchanged — the package states what it wants, the person states what it
 * gets, and no code path reads the second from the first.
 */

const TADO = "kavibay.tado/tado";
const ELSEWHERE = "kavibay.nope/nope";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function boot() {
  const reg = new ExtensionRegistry();
  reg.load(tadoExtension, { kind: "bundled" });
  assert(reg.link().length === 0, `the fixture must link: ${JSON.stringify(reg.errors)}`);
  return reg;
}

/** A package naming one installed provider and one nobody ships. */
const asking = {
  name: "room-summary",
  version: "1.0.0",
  displayName: "Room summary",
  engines: { kavibay: "^0.1" },
  widget: {
    name: "tile",
    displayName: "Room summary",
    requires: { providers: [TADO, ELSEWHERE] },
  },
};

const onlyTado = {
  ...asking,
  widget: { ...asking.widget, requires: { providers: [TADO] } },
};

// --- what is offered, and what is not ---
{
  const request = buildPermissionRequest(asking, boot());

  assert(request.choices.length === 1, `only installed providers are offered: ${request.choices.length}`);
  assert(request.choices[0]!.providerName === "Tado", "and by their display name, not their id");
  assert(
    request.choices[0]!.summary.length > 0,
    "with a sentence about what reading from it gets you",
  );

  /**
   * A generated manifest naming a provider that does not exist is ordinary, not
   * an attack. Offering it would teach the person to click through the dialog,
   * which costs more than any single grant — but hiding it entirely would make
   * the dialog list less than the package asked for.
   */
  assert(request.refused.includes(ELSEWHERE), "and one nobody ships is refused, visibly");
}

// --- nothing is granted until it is ticked ---
{
  const request = buildPermissionRequest(onlyTado, boot());
  assert(request.choices.every((c) => !c.granted), "no box starts ticked");

  const nothing = grantFrom(request);
  assert(nothing.providers.length === 0, "so the grant from an untouched dialog is empty");
}

// --- ticking one grants exactly that one ---
{
  const request = buildPermissionRequest(asking, boot());
  request.choices.find((c) => c.provider === TADO)!.granted = true;

  const grant = grantFrom(request);
  assert(grant.providers.join(",") === TADO, `only what was ticked, got ${grant.providers}`);
  assert(
    !grant.providers.includes(ELSEWHERE),
    "and never something that was refused rather than offered",
  );
}

// --- the grant is what the loader accepts, end to end ---
{
  const registry = boot();
  const request = buildPermissionRequest(onlyTado, registry);
  request.choices.find((c) => c.provider === TADO)!.granted = true;

  const manifest = widgetPackageManifest(onlyTado, grantFrom(request));
  const widget = manifest.contributes.widgets![0]!;
  assert(widget.requires?.providers.join(",") === TADO, "the widget loads addressing what was ticked");

  const loaded = new ExtensionRegistry();
  loaded.load(tadoExtension, { kind: "bundled" });
  assert(
    loaded.load(manifest, { kind: "generated", builderSessionId: "s" }) !== undefined,
    `a dialog-produced grant loads: ${JSON.stringify(loaded.errors)}`,
  );
}

// --- approving nothing is an answer, and the package still loads ---
{
  const registry = boot();
  const request = buildPermissionRequest(onlyTado, registry);
  const manifest = widgetPackageManifest(
    { ...onlyTado, widget: { ...onlyTado.widget, requires: { providers: [] } } },
    grantFrom(request),
  );
  assert(
    manifest.contributes.widgets![0]!.requires === undefined,
    "a widget approved for nothing addresses nothing, rather than failing to load",
  );
}

// --- a package that asks for nothing gets an empty dialog, not a broken one ---
{
  const plain = { ...asking, widget: { name: "t", displayName: "T" } };
  const request = buildPermissionRequest(plain, boot());
  assert(request.choices.length === 0 && request.refused.length === 0, "nothing to ask about");
  assert(grantFrom(request).providers.length === 0, "and nothing to grant");
}

// --- carried grants: the dialog only comes back when something is new ---
{
  const reg = boot();

  const fresh = buildPermissionRequest(onlyTado, reg);
  assert(fresh.choices.every((c) => !c.granted), "a request on its own pre-ticks nothing");
  assert(!askedNothingNew(fresh, null), "with no prior grant there is always something to decide");

  const carried = buildPermissionRequest(onlyTado, reg, [TADO]);
  assert(
    carried.choices.every((c) => c.granted),
    "an account the person already approved for this package comes back ticked",
  );
  assert(askedNothingNew(carried, [TADO]), "the same request against the same grant asks nothing new");

  // Narrowing is the user's to do in Settings, not a reason to interrupt an edit.
  assert(
    askedNothingNew(carried, [TADO, "kavibay.other/x"]),
    "asking for less than was granted still decides nothing",
  );

  assert(
    !askedNothingNew(carried, ["kavibay.other/x"]),
    "a grant for a different account is not this grant",
  );

  /**
   * A refused provider is not on offer, so it cannot be part of a decision —
   * otherwise every edit of a package naming an uninstalled account would
   * reopen the dialog forever, with nothing in it the person could act on.
   */
  const withMissing = buildPermissionRequest(asking, reg, [TADO]);
  assert(
    askedNothingNew(withMissing, [TADO]),
    "and a provider nobody ships does not keep the dialog coming back",
  );
}

console.log("permission-request.assert.ts: ok");
