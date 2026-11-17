import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adminAuthMode,
  adminSessionCookies,
  adminSessionValue,
  checkAdminCredential,
  clearedAdminSessionCookies,
  constantTimeEqual,
  safeAdminPath,
  sha256Hex,
} from "./admin-auth";

const TOKEN = "test-admin-token";

test("adminAuthMode mirrors authorizeJob: open in development, 503 in production", () => {
  assert.deepEqual(adminAuthMode({ ADMIN_TOKEN: TOKEN, NODE_ENV: "production" }), { mode: "token", token: TOKEN });
  assert.deepEqual(adminAuthMode({ NODE_ENV: "development" }), { mode: "open-dev" });
  assert.deepEqual(adminAuthMode({ ADMIN_TOKEN: "  ", NODE_ENV: "production" }), { mode: "unconfigured" });
});

test("sha256Hex matches the known digest", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("constantTimeEqual", () => {
  assert.equal(constantTimeEqual("abcd", "abcd"), true);
  assert.equal(constantTimeEqual("abcd", "abce"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
});

test("bearer and cookie credentials", async () => {
  const cookie = await adminSessionValue(TOKEN);
  assert.notEqual(cookie, TOKEN);
  assert.equal(cookie.includes(TOKEN), false);
  assert.equal(await checkAdminCredential({ authorization: `Bearer ${TOKEN}`, cookie: null }, TOKEN), "valid");
  assert.equal(await checkAdminCredential({ authorization: "Bearer wrong", cookie: null }, TOKEN), "invalid-bearer");
  // A wrong header is judged on its own even with a valid cookie alongside.
  assert.equal(await checkAdminCredential({ authorization: "Basic xyz", cookie }, TOKEN), "invalid-bearer");
  assert.equal(await checkAdminCredential({ authorization: null, cookie }, TOKEN), "valid");
  // The raw token is not a valid cookie value.
  assert.equal(await checkAdminCredential({ authorization: null, cookie: TOKEN }, TOKEN), "invalid-cookie");
  assert.equal(await checkAdminCredential({ authorization: null, cookie: null }, TOKEN), "none");
});

test("session cookies are httpOnly, SameSite=Strict, path-scoped, Secure off localhost", () => {
  const [pages, api] = adminSessionCookies("v", { secure: true });
  assert.equal(pages, "admin_session=v; Max-Age=604800; Path=/admin; HttpOnly; SameSite=Strict; Secure");
  assert.match(api, /Path=\/api\/admin;/);
  assert.equal(adminSessionCookies("v", { secure: false })[0].includes("Secure"), false);
  assert.match(clearedAdminSessionCookies({ secure: true })[0], /^admin_session=; Max-Age=0; /);
});

test("safeAdminPath only returns paths inside the admin tree", () => {
  assert.equal(safeAdminPath("/admin/data-health?x=1"), "/admin/data-health?x=1");
  assert.equal(safeAdminPath("/admin"), "/admin");
  assert.equal(safeAdminPath("https://evil.example/admin"), "/admin/data-health");
  assert.equal(safeAdminPath("//evil.example"), "/admin/data-health");
  assert.equal(safeAdminPath("/administrator"), "/admin/data-health");
  assert.equal(safeAdminPath("/admin/login"), "/admin/data-health");
  assert.equal(safeAdminPath("/admin/x\r\nSet-Cookie: a=b"), "/admin/data-health");
  assert.equal(safeAdminPath(null), "/admin/data-health");
});
