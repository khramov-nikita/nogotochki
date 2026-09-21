import assert from "node:assert/strict";
import test from "node:test";
import { setSessionCookie, shouldUseSecureCookies } from "./cookies.js";

function fakeReq({ secure = false, proto = null } = {}) {
  return {
    secure,
    get(name) {
      if (String(name).toLowerCase() === "x-forwarded-proto") {
        return proto;
      }
      return undefined;
    },
  };
}

test("shouldUseSecureCookies is false on plain HTTP", () => {
  assert.equal(shouldUseSecureCookies(fakeReq()), false);
  assert.equal(shouldUseSecureCookies(fakeReq({ proto: "http" })), false);
});

test("shouldUseSecureCookies is true for HTTPS and forwarded https", () => {
  assert.equal(shouldUseSecureCookies(fakeReq({ secure: true })), true);
  assert.equal(shouldUseSecureCookies(fakeReq({ proto: "https" })), true);
  assert.equal(shouldUseSecureCookies(fakeReq({ proto: "https, http" })), true);
});

test("setSessionCookie omits Secure on HTTP deploys", () => {
  const headers = [];
  const res = {
    append(name, value) {
      headers.push({ name, value });
    },
  };
  setSessionCookie(res, "tok", 60, false);
  assert.equal(headers.length, 1);
  assert.match(headers[0].value, /session=tok/);
  assert.doesNotMatch(headers[0].value, /;\s*Secure(?:;|$)/);
});
