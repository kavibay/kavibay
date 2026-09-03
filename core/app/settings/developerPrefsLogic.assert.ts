/**
 * Run: npx tsx src/settings/developerPrefsLogic.assert.ts
 */
import {
  DEFAULT_DEVELOPER_PREFS,
  normalizeDeveloperPrefs,
} from "./developerPrefsLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  DEFAULT_DEVELOPER_PREFS.developerExtensionsEnabled === true,
  "ships on",
);
assert(
  normalizeDeveloperPrefs(null).developerExtensionsEnabled === false,
  "null → off",
);
assert(
  normalizeDeveloperPrefs({ developerExtensionsEnabled: true })
    .developerExtensionsEnabled === true,
  "true preserved",
);
assert(
  normalizeDeveloperPrefs({ developerExtensionsEnabled: "yes" })
    .developerExtensionsEnabled === false,
  "non-boolean → off",
);

// --- wizard auto-enable ----------------------------------------------------
//
// The one flag that hands out network access and a credential grant with no
// consent step, so every path to `true` is pinned.

assert(DEFAULT_DEVELOPER_PREFS.wizardAutoEnable === true, "auto-enable ships on");
assert(normalizeDeveloperPrefs(null).wizardAutoEnable === false, "null → off");
assert(
  normalizeDeveloperPrefs({ developerExtensionsEnabled: true, wizardAutoEnable: true })
    .wizardAutoEnable === true,
  "on only with developer mode on",
);
// The dangerous case: a record that kept the bypass after developer mode went
// away — by a hand-edited localStorage, or by the toggles being set in either
// order. Reading it must not resurrect the bypass.
assert(
  normalizeDeveloperPrefs({ developerExtensionsEnabled: false, wizardAutoEnable: true })
    .wizardAutoEnable === false,
  "developer mode off drags the bypass off with it",
);
assert(
  normalizeDeveloperPrefs({ developerExtensionsEnabled: true, wizardAutoEnable: "yes" })
    .wizardAutoEnable === false,
  "non-boolean → off",
);

console.log("developerPrefsLogic.assert.ts: ok");
