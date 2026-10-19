import test from "node:test";
import assert from "node:assert/strict";
import { arrivalQrUrl, bookingQrImage, doctorBookingUrl } from "../src/lib/doctorBooking.ts";

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

test("signed attendance links keep their signature for both doctor and clinic",()=>{
 const id='11111111-1111-4111-8111-111111111111';
 for (const kind of ['doctor','clinic']) {
  const code='medbook-arrival:v2:'+kind+':'+id+':'+ 'a'.repeat(32);
  const url=new URL(arrivalQrUrl(code));
  assert.equal(url.pathname,'/account/arrival');
  assert.equal(url.searchParams.get('code'),code);
  assert.equal([...url.searchParams].length,1);
 }
 assert.throws(()=>arrivalQrUrl('medbook-arrival:v1:doctor:'+id));
 assert.throws(()=>arrivalQrUrl('invalid'));
});
