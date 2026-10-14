import test from "node:test";
import assert from "node:assert/strict";
import { bookingQrImage, doctorBookingUrl } from "../src/lib/doctorBooking.ts";

test("doctor QR encodes only the public doctor booking route and rejects missing identity", () => {
  assert.equal(doctorBookingUrl(null), null);
  assert.equal(doctorBookingUrl("  "), null);
  assert.equal(doctorBookingUrl("doctor-test-public"), "https://medbook-alpha.vercel.app/?doctor=doctor-test-public");
  const url = new URL(doctorBookingUrl("doctor / ?", "https://booking.example/old?patient=private#token")!);
  assert.equal(url.pathname, "/");
  assert.deepEqual([...url.searchParams], [["doctor", "doctor / ?"]]);
  assert.equal(url.hash, "");
  assert.throws(() => doctorBookingUrl("doctor", "javascript:alert(1)"));
  assert.throws(() => doctorBookingUrl("doctor", "http://external.example"));
  const qr = decodeURIComponent(bookingQrImage(doctorBookingUrl("doctor-test-public")!).split(",")[1]);
  assert.match(qr, /<svg/);
  assert.doesNotMatch(qr, /https?:\/\/.*(?:qrserver|google)/);
});
