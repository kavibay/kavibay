// Run on macOS: swift scripts/runtimeWebKitSmoke.swift
// Uses an ephemeral WKWebView; no Kavibay profile or running app is touched.
import Cocoa
import WebKit

let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let source = try String(contentsOf: repo.appendingPathComponent("src-tauri/src/runtime_extensions/protocol.rs"), encoding: .utf8)
let cspPattern = try NSRegularExpression(pattern: #"const EXTENSION_FRAME_CSP: &str = concat!\(([\s\S]*?)\n\);"#)
guard let block = cspPattern.firstMatch(in: source, range: NSRange(source.startIndex..., in: source)),
      let range = Range(block.range(at: 1), in: source) else {
    fatalError("Cannot read the production frame CSP")
}
let cspBlock = String(source[range])
let stringPattern = try NSRegularExpression(pattern: #""([^"]*)""#)
let csp = stringPattern.matches(in: cspBlock, range: NSRange(cspBlock.startIndex..., in: cspBlock)).map {
    String(cspBlock[Range($0.range(at: 1), in: cspBlock)!])
}.joined()
let contractSDK = try Data(contentsOf: repo.appendingPathComponent("sdk/contract-guest/kavibay-contract-guest.js"))
let sdk = try Data(contentsOf: repo.appendingPathComponent("sdk/runtime/kavibay-runtime.js"))

let frameGestures = try Data(contentsOf: repo.appendingPathComponent("core/app/runtime/frameGestures.js"))
let frameViewportCSS = try String(contentsOf: repo.appendingPathComponent("core/app/runtime/frameViewport.css"), encoding: .utf8)

let hostHTML = """
<!doctype html><style>
body { margin: 0; }
.card { --widget-content-scale: 1.25; width: 360px; height: 240px; display: flex; flex-direction: column; }
.body { zoom: var(--widget-content-scale, 1); flex: 1; min-height: 0; display: flex; flex-direction: column; }
.widget-frame-viewport { flex: 1; }
\(frameViewportCSS)
</style>
<div class="card"><div class="body"><div class="widget-frame-viewport">
<iframe sandbox="allow-scripts" src="kavibay-ext://localhost/water-tracker/@run/first/ui/index.html"></iframe>
</div></div></div>
<iframe id="contract-frame" hidden sandbox="allow-scripts" src="kavibay-ext://localhost/contract/@run/bad/index.html"></iframe>
<script>
const frame = document.querySelector('iframe');
const contractFrame = document.querySelector('#contract-frame');
let contractSaved = {glasses:3};
let contractStage = 'bad';
let runtimeDone = false, contractDone = false;
const finish = () => { if (runtimeDone && contractDone) window.webkit.messageHandlers.result.postMessage('ok'); };
addEventListener('message', e => {
  if (e.source !== contractFrame.contentWindow) return;
  const m = e.data;
  if (m.kind === 'kavibay.widget.ready') e.source.postMessage({kind:'kavibay.widget.init',payload:JSON.stringify({instance:{id:'test',definitionId:'test/counter',configuration:{},position:{x:0,y:0},size:{w:2,h:2},mode:'compact'},providers:[]})}, '*');
  if (m.kind === 'kavibay.widget.request') {
    const request = JSON.parse(m.payload);
    if (request.type === 'data.set') contractSaved = request.value;
    e.source.postMessage({kind:'kavibay.widget.response',id:m.id,payload:JSON.stringify({ok:true,value:contractSaved})}, '*');
  }
  if (m.kind === 'kavibay.widget.failed') {
    if (contractStage !== 'bad' || !JSON.parse(m.payload).message.includes('Use await') || contractSaved.glasses !== 3) return fail('Contract missing await was silent or overwrote data');
    contractStage = 'fixed';
    contractFrame.src = contractFrame.src.replace('/bad/', '/fixed/');
  }
  if (m.type === 'test:contract-loaded') {
    if (m.glasses !== (contractStage === 'reload' ? 4 : 3)) return fail('Contract lost the saved counter');
    if (contractStage === 'fixed') e.source.postMessage({type:'test:click'}, '*');
    else { contractDone = true; finish(); }
  }
  if (m.type === 'test:contract-saved') {
    if (contractSaved.glasses !== 4) return fail('Contract click was not saved');
    contractStage = 'reload';
    contractFrame.src = contractFrame.src.replace('/fixed/', '/reload/');
  }
});
let saved = null;
let reloaded = false;
let zoom = [];
const fail = error => window.webkit.messageHandlers.result.postMessage(String(error));
addEventListener('message', e => {
  if (e.source !== frame.contentWindow) return;
  const m = e.data;
  if (m.type === 'kavibay.ext.zoom') zoom.push(m);
  if (m.type === 'test:failed') return fail(m.error);
  if (m.type === 'kavibay.ext.storage.set') saved = m.value;
  if (m.type === 'kavibay.ext.storage.get' || m.type === 'kavibay.ext.storage.set') {
    e.source.postMessage({type:'kavibay.ext.storage.result', requestId:m.requestId, ok:true, value:saved}, '*');
  }
  if (m.type === 'test:loaded') {
    if (m.revision !== (reloaded ? 2 : 1)) return fail('Reload reused the previous widget script');
    if (zoom.length !== 3 || zoom[0].kind !== 'wheel' || zoom[0].deltaY !== -100
        || zoom[1].factor !== 1.5 || zoom[2].factor !== 2 / 1.5) return fail('Host zoom gestures did not cross the iframe');
    zoom = [];
    if (!reloaded) {
      if (m.total !== 0) return fail('Expected initial total 0');
      e.source.postMessage({type:'test:click'}, '*');
    } else {
      if (m.total !== 250 || saved.totalMl !== 250) return fail('Reload lost the saved total');
      runtimeDone = true; finish();
    }
  }
  if (m.type === 'test:saved') {
    if (m.total !== 250) return fail('Button did not update the displayed total');
    reloaded = true;
    frame.src = frame.src.replace('/@run/first/', '/@run/second/');
  }
});
</script>
"""
let widgetHTML = """
<!doctype html><html><head><script src="@kavibay/frame.js"></script><link rel="stylesheet" href="style.css"></head><body>
<div style="width:40px;height:20px;background:rgb(255,0,0)"></div>
<button type="button" id="add" onclick="window.inlineHandlerRan=true">+250 ml</button><output>0</output>
<img src="drop.svg" alt="water">
<script>window.inlineScriptRan=true</script>
<script src="@kavibay/runtime.js"></script><script src="app.js"></script>
</body></html>
"""
let widgetJS = """
const revision = __REVISION__;
const report = (type, fields) => parent.postMessage({type, ...fields}, '*');
const check = (ok, message) => { if (!ok) throw new Error(message); };
let total = 0;
const output = document.querySelector('output');
const render = () => { output.textContent = total; };
document.querySelector('button').addEventListener('click', async () => {
  try {
    total += 250;
    render();
    await kavibay.storage.set({totalMl:total});
    check(!window.inlineHandlerRan, 'Inline event handler was allowed');
    report('test:saved', {total:Number(output.textContent)});
  } catch (e) { report('test:failed', {error:String(e)}); }
});
addEventListener('message', e => {
  if (e.source === parent && e.data.type === 'test:click') document.querySelector('button').click();
});
addEventListener('load', async () => {
  try {
    check(!window.inlineScriptRan, 'Inline script was allowed');
    check(getComputedStyle(output).color === (revision === 1 ? 'rgb(1, 2, 3)' : 'rgb(4, 5, 6)'), 'Package stylesheet did not load');
    check(document.querySelector('img').naturalWidth === (revision === 1 ? 4 : 8), 'Package image did not load');
    let isolated = false;
    try { void parent.document; } catch { isolated = true; }
    check(isolated, 'Guest can read the host DOM');
    let storageBlocked = false;
    try { void localStorage; } catch { storageBlocked = true; }
    check(storageBlocked, 'Guest has direct localStorage access');
    // A rejected fetch alone could be CORS; require the actual CSP violation.
    const networkBlocked = new Promise(resolve => addEventListener('securitypolicyviolation', e => {
      if (e.effectiveDirective === 'connect-src') resolve();
    }));
    try { await fetch('kavibay-ext://localhost/water-tracker/ui/drop.svg'); } catch {}
    await networkBlocked;
    let missingAwaitReported = false;
    try { void kavibay.storage.get().totalMl; } catch (e) { missingAwaitReported = String(e).includes('Use await'); }
    check(missingAwaitReported, 'Missing storage await was silent');
    const saved = await kavibay.storage.get();
    total = saved?.totalMl ?? 0;
    render();
    dispatchEvent(new WheelEvent('wheel', {ctrlKey:true, deltaY:-100, cancelable:true}));
    dispatchEvent(new Event('gesturestart', {cancelable:true}));
    for (const scale of [1.5, 2]) dispatchEvent(Object.assign(new Event('gesturechange', {cancelable:true}), {scale}));
    dispatchEvent(new Event('gestureend', {cancelable:true}));
    dispatchEvent(new WheelEvent('wheel', {deltaY:50, cancelable:true}));
    report('test:loaded', {total:Number(output.textContent), revision});
  } catch (e) { report('test:failed', {error:String(e)}); }
});
"""

let contractHTML = """
<!doctype html><div id="kavibay-widget"></div>
<script src="@kavibay/contract.js"></script><script src="widget.js"></script>
"""
let contractJS = """
kavibayWidget.define({
  async setup(ctx) {
    if (location.pathname.includes('/bad/')) {
      const saved = ctx.data.get('water');
      await ctx.data.set('water', {glasses:saved.glasses ?? 0});
    }
    const saved = await ctx.data.get('water');
    return {glasses:saved.glasses, async add() { this.glasses++; await ctx.data.set('water', {glasses:this.glasses}); }};
  },
  render(model, root) {
    const button = document.createElement('button');
    button.textContent = String(model.glasses);
    button.addEventListener('click', async () => {
      await model.add();
      button.textContent = String(model.glasses);
      parent.postMessage({type:'test:contract-saved'}, '*');
    });
    addEventListener('message', e => { if (e.source === parent && e.data.type === 'test:click') button.click(); });
    root.replaceChildren(button);
    parent.postMessage({type:'test:contract-loaded',glasses:Number(button.textContent)}, '*');
  }
});
"""

final class Smoke: NSObject, WKURLSchemeHandler, WKScriptMessageHandler {
    var finished = false
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.body as? String == "ok" {
            checkLiveScale(0)
            return
        }
        fail(String(describing: message.body))
    }
    func fail(_ message: String) -> Never {
        fputs("runtimeWebKitSmoke: \(message)\n", stderr)
        exit(1)
    }

    // Inspect rendered pixels: an iframe's box and computed styles can both
    // change while WebKit still draws its document at the previous zoom.
    func checkLiveScale(_ step: Int) {
        let scales = [1.25, 2.0, 0.75, 1.5]
        guard step < scales.count else {
            finished = true
            print("runtimeWebKitSmoke: ok (click, save, reload with changed JS/CSS/image, both SDKs and storage await guards, zoom gestures, live iframe scaling, local assets, sandbox and CSP)")
            exit(0)
        }
        let scale = scales[step]
        let js = """
        document.querySelector('.card').style.setProperty('--widget-content-scale', '\(scale)');
        document.querySelector('.card').style.width = '\(step == 3 ? 380 : 360)px';
        """
        webview.evaluateJavaScript(js) { _, error in
            if let error { self.fail(error.localizedDescription) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                webview.takeSnapshot(with: nil) { image, error in
                    guard let tiff = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else {
                        self.fail("Cannot inspect frame snapshot: \(String(describing: error))")
                    }
                    var minX = bitmap.pixelsWide, minY = bitmap.pixelsHigh, maxX = -1, maxY = -1
                    for y in 0..<bitmap.pixelsHigh {
                        for x in 0..<bitmap.pixelsWide {
                            guard let c = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.sRGB),
                                  c.redComponent > 0.8, c.greenComponent < 0.3, c.blueComponent < 0.3 else { continue }
                            minX = min(minX, x); maxX = max(maxX, x)
                            minY = min(minY, y); maxY = max(maxY, y)
                        }
                    }
                    let pixelsPerPoint = Double(bitmap.pixelsWide) / Double(webview.bounds.width)
                    let width = Double(max(0, maxX - minX + 1)), height = Double(max(0, maxY - minY + 1))
                    guard abs(width - 40 * scale * pixelsPerPoint) <= 2,
                          abs(height - 20 * scale * pixelsPerPoint) <= 2 else {
                        self.fail("Live scale \(scale): guest marker rendered at \(width)×\(height) pixels")
                    }
                    self.checkLiveScale(step + 1)
                }
            }
        }
    }
    func webView(_ view: WKWebView, start task: WKURLSchemeTask) {
        let url = task.request.url!
        let body: Data
        let type: String
        if url.scheme == "smoke-host" {
            body = Data(hostHTML.utf8); type = "text/html"
        } else {
            let second = url.path.contains("/@run/second/")
            let path = url.path.replacingOccurrences(of: "/@run/first/", with: "/").replacingOccurrences(of: "/@run/second/", with: "/")
            switch path {
            case let contractPath where contractPath.hasPrefix("/contract/"):
                if contractPath.hasSuffix("/index.html") { body = Data(contractHTML.utf8); type = "text/html" }
                else if contractPath.hasSuffix("/@kavibay/contract.js") { body = contractSDK; type = "text/javascript" }
                else { body = Data(contractJS.utf8); type = "text/javascript" }
            case "/water-tracker/ui/index.html": body = Data(widgetHTML.utf8); type = "text/html"
            case "/water-tracker/ui/@kavibay/frame.js": body = frameGestures; type = "text/javascript"
            case "/water-tracker/ui/@kavibay/runtime.js": body = sdk; type = "text/javascript"
            case "/water-tracker/ui/app.js": body = Data(widgetJS.replacingOccurrences(of: "__REVISION__", with: second ? "2" : "1").utf8); type = "text/javascript"
            case "/water-tracker/ui/style.css": body = Data("output { color: \(second ? "rgb(4, 5, 6)" : "rgb(1, 2, 3)") }".utf8); type = "text/css"
            case "/water-tracker/ui/drop.svg":
                body = Data("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"\(second ? 8 : 4)\" height=\"4\"/>".utf8); type = "image/svg+xml"
            default:
                task.didFailWithError(NSError(domain: "smoke", code: 404)); return
            }
        }
        var headers = ["Content-Type":type, "X-Content-Type-Options":"nosniff", "Cache-Control":"no-store"]
        if url.scheme == "kavibay-ext" { headers["Content-Security-Policy"] = csp }
        task.didReceive(HTTPURLResponse(url:url, statusCode:200, httpVersion:"HTTP/1.1", headerFields:headers)!)
        task.didReceive(body)
        task.didFinish()
    }
    func webView(_ view: WKWebView, stop task: WKURLSchemeTask) {}
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let smoke = Smoke()
let config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
config.setURLSchemeHandler(smoke, forURLScheme:"kavibay-ext")
config.setURLSchemeHandler(smoke, forURLScheme:"smoke-host")
config.userContentController.add(smoke, name:"result")
let webview = WKWebView(frame:NSRect(x:0,y:0,width:400,height:300), configuration:config)
let window = NSWindow(contentRect:webview.frame, styleMask:[.borderless], backing:.buffered, defer:false)
window.contentView = webview
webview.load(URLRequest(url:URL(string:"smoke-host://localhost/index.html")!))
DispatchQueue.main.asyncAfter(deadline:.now()+10) {
    if !smoke.finished {
        fputs("runtimeWebKitSmoke: timed out waiting for widget scripts and storage\n", stderr)
        exit(1)
    }
}
app.run()
