/**
 * اختبار وحدة (بلا قاعدة بيانات) لطابور الانتظار داخل العملية لكل طبيب (withDoctorQueueTurn):
 * لا يزيد عدد المنفِّذين معًا عن الحد، يحترم ترتيب الوصول، يحرّر الخانة عند الفشل، ويرفض الانتظار الطويل.
 */
import { describe, it, expect } from "vitest";
import { withDoctorQueueTurn, DoctorQueueBusyError } from "../src/lib/doctorLock";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("withDoctorQueueTurn", () => {
  it("لا يشغّل أكثر من اثنين معًا لنفس الطبيب، ويشغّل الجميع", async () => {
    let running = 0;
    let peak = 0;
    let done = 0;
    await Promise.all(
      Array.from({ length: 40 }, () =>
        withDoctorQueueTurn("doc-A", 5000, async () => {
          running++;
          peak = Math.max(peak, running);
          await sleep(5);
          running--;
          done++;
        })
      )
    );
    expect(done).toBe(40);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("أطباء مختلفون لا يُقيّد بعضهم بعضًا", async () => {
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        withDoctorQueueTurn(`doc-${i}`, 5000, async () => {
          running++;
          peak = Math.max(peak, running);
          await sleep(20);
          running--;
        })
      )
    );
    expect(peak).toBe(6);
  });

  it("يحترم ترتيب الوصول (FIFO) للمنتظرين", async () => {
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        withDoctorQueueTurn("doc-fifo", 5000, async () => {
          order.push(i);
          await sleep(3);
        })
      )
    );
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("يحرّر الخانة عند فشل الدالة (لا يعلق الطابور)", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        withDoctorQueueTurn("doc-err", 5000, async () => {
          await sleep(2);
          if (i % 2 === 0) throw new Error("boom" + i);
          return i;
        })
      )
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(3);
    // بعد الفشل ما زال الطابور يعمل
    expect(await withDoctorQueueTurn("doc-err", 1000, async () => "ok")).toBe("ok");
  });

  it("يرفض بـ DoctorQueueBusyError عند تجاوز حدّ الانتظار دون تنفيذ الدالة، ولا يُفسد الطابور", async () => {
    let started = 0;
    const slow = () =>
      withDoctorQueueTurn("doc-busy", 5000, async () => {
        started++;
        await sleep(150);
      });
    const holders = [slow(), slow()]; // يشغلان الخانتين
    let ranWhenRejected = false;
    const rejected = withDoctorQueueTurn("doc-busy", 30, async () => {
      ranWhenRejected = true;
    });
    await expect(rejected).rejects.toBeInstanceOf(DoctorQueueBusyError);
    expect(ranWhenRejected).toBe(false);
    await Promise.all(holders);
    expect(started).toBe(2);
    expect(await withDoctorQueueTurn("doc-busy", 1000, async () => "ok")).toBe("ok");
  });
});
