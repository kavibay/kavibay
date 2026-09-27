import { packageFrameUrl } from "./packageFrameUrl";

function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }
for (const base of [
  "kavibay-ext://localhost/weather/ui/index.html",
  "http://kavibay-ext.localhost/weather/ui/index.html",
  "kavibay-ext://weather/ui/index.html",
  "kavibay-ext://localhost/__draft__weather/ui/index.html?revision=abc",
]) {
  const first = packageFrameUrl(base, "first-run");
  const second = packageFrameUrl(base, "second-run");
  assert(first !== second, "remounting gets a new document URL");
  for (const relative of ["widget.js", "style.css", "../assets/icon.svg", "@kavibay/contract.js"]) {
    const before = new URL(relative, first).href;
    const after = new URL(relative, second).href;
    assert(before !== after && after.includes("/@run/second-run/"), `${relative} cannot reuse the previous frame's cached asset`);
  }
  assert(new URL(first).search === new URL(base).search, "package revision stays on the entry URL");
}
assert(packageFrameUrl("https://fixture.test/widget.html", "first") !== packageFrameUrl("https://fixture.test/widget.html", "retry"), "Retry also reloads browser fixtures");
console.log("packageFrameUrl.assert: ok");
