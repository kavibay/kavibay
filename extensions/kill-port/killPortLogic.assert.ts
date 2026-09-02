/**
 * Checks for kill-port palette argument parsing.
 * Run: npx tsx extensions/kill-port/killPortLogic.assert.ts
 */
import { parsePort } from "./killPortLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(parsePort("3000") === 3000, "bare port");
assert(parsePort(" 8080 ") === 8080, "trims");
assert(parsePort(":5173") === 5173, "leading colon");
assert(parsePort("localhost:3000") === 3000, "host:port");
assert(parsePort("127.0.0.1:8080") === 8080, "ipv4:port");
assert(parsePort("http://localhost:5173") === 5173, "url");
assert(parsePort("http://127.0.0.1:3000/api") === 3000, "url with path");
assert(parsePort("[::1]:8080") === 8080, "ipv6 with port");
assert(parsePort("65535") === 65535, "max port");
assert(parsePort("1") === 1, "min port");

assert(parsePort("") === null, "empty");
assert(parsePort("   ") === null, "blank");
assert(parsePort("0") === null, "port 0");
assert(parsePort("65536") === null, "above max");
assert(parsePort("3000.5") === null, "fraction");
assert(parsePort("abc") === null, "letters");
assert(parsePort("http://localhost") === null, "url without port");
assert(parsePort("-1") === null, "negative");

console.log("killPortLogic.assert.ts: ok");
