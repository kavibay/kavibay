import { isSafeExtensionIconPath } from "./extensionIcon.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(isSafeExtensionIconPath("icon.svg") === true, "accept icon.svg");
assert(isSafeExtensionIconPath("icon.png") === true, "accept icon.png");
assert(isSafeExtensionIconPath("assets/icon.svg") === true, "accept nested");
assert(isSafeExtensionIconPath("../evil.svg") === false, "reject traversal");
assert(isSafeExtensionIconPath("/etc/passwd.svg") === false, "reject absolute");
assert(isSafeExtensionIconPath("icon.gif") === false, "reject gif");
assert(isSafeExtensionIconPath("") === false, "reject empty");

console.log("extensionIcon.assert.ts: ok");
