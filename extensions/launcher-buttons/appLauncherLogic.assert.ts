import { displayName, launcherDesktop } from "./appLauncherLogic";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const mac = launcherDesktop("MacIntel");
assert(mac.appFiles.join() === ".app", "a Mac picks .app files");
assert(mac.appFileBadge === "APP", "a Mac badges the Files section APP");
assert(mac.fileManager === "Finder", "a Mac opens folders in Finder");
assert(mac.computer === "your Mac", "a Mac is called a Mac");
assert(!mac.keys, "a Mac offers no media or system keys");

const windows = launcherDesktop("Win32");
assert(windows.appFiles.join() === ".exe,.lnk", "Windows picks .exe and .lnk files");
assert(windows.appFileBadge === "EXE", "Windows badges the Files section EXE");
assert(windows.fileManager === "Explorer", "Windows opens folders in Explorer");
assert(windows.keys, "Windows offers media and system keys");

assert(displayName("/Applications/Safari.app") === "Safari", "an app bundle is named without .app");
assert(displayName("C:\\Tools\\app.exe") === "app", "an exe is named without .exe");
assert(displayName("/Users/me/Downloads/") === "Downloads", "a folder keeps its name");
