/** Opt-in HTTP workload against a NEW, loopback-only PostgreSQL test database.
 * 1000 different patients, 15 doctors and 15 linked assistants; no external messaging.
 * This measures local API capacity, not Render capacity or 30 rendered browser tabs.
 */
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import http from "node:http";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

const enabled = process.env.RUN_CLINIC_LOAD === "1";
const quotas = [100,90,85,80,75,70,70,65,65,60,55,50,50,45,40];
type Actor = { id: string; token: string; email: string; ip: string; role: "PATIENT"|"DOCTOR"|"ASSISTANT"; patientId?: string; doctorId?: string };
type Sample = { operation: string; status: number; ms: number; expected: boolean; message?: string };

describe.skipIf(!enabled)("Clinic day: 1000 patients + 15 doctors + 15 assistants", () => {
  let db: PrismaClient, server: http.Server, base: string, date: string, today: Date;
  let wilayaId: string, cityId: string, specialtyId: string;
  const patients: Actor[] = [], doctors: Actor[] = [], assistants: Actor[] = [];
  const samples: Sample[] = [], violations: string[] = [];
  const tag = `load-${Date.now()}`;
  const password = "LocalLoadTestOnly!2026";
  let running = false;
  const report: Record<string, any> = { tag, environment: "local HTTP / PostgreSQL; not hosted production", quotas, doctors: 15, assistants: 15, patients: 1000, browserTabs: 0 };
  const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

  async function call(actor: Actor, operation: string, path: string, method = "GET", body?: unknown, expected = [200]) {
    const start = performance.now();
    let status = 0, json: any = {};
    try {
      const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${actor.token}`, "content-type": "application/json", "x-forwarded-for": actor.ip }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
      status = r.status;
      json = await r.json();
    } catch (e: any) { json.message = e.name; }
    samples.push({ operation, status, ms: Math.round(performance.now()-start), expected: expected.includes(status), ...(!expected.includes(status) ? { message: json.message } : {}) });
    return { status, data: json.data };
  }

  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.pathname !== '/medbook_load_test') throw new Error('Requires loopback database named medbook_load_test');
    process.env.DATABASE_URL = url.href;
    // Retain the real rate limits. Each clinic shares one simulated client IP.
    process.env.RATE_LIMIT_MAX = '1500';
    process.env.TRUST_PROXY_HOPS = '1';
    process.env.JWT_ACCESS_EXPIRES = '1h';
    process.env.REMINDERS_ENABLED = 'false';
    for (const key of ['BUDGETSMS_USERNAME','BUDGETSMS_USERID','BUDGETSMS_HANDLE','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY']) process.env[key] = '';
    db = new PrismaClient({ datasourceUrl: url.href });
    if (await db.user.count() !== 0) throw new Error('Requires empty database; refuses existing data');
    const { signAccessToken } = await import('../../src/utils/jwt');
    const { hashPassword } = await import('../../src/utils/password');
    const hash = await hashPassword(password);
    wilayaId = (await db.wilaya.create({ data: { code: tag, nameAr: 'ولاية اختبار الضغط' } })).id;
    cityId = (await db.city.create({ data: { wilayaId, nameAr: 'مدينة اختبار' } })).id;
    specialtyId = (await db.specialty.create({ data: { nameAr: tag } })).id;
    const actor = (id: string, role: Actor['role'], email: string, ip: string): Actor => ({ id, role, email, ip, token: signAccessToken({sub:id, role}) });
    for (let i=0;i<15;i++) {
      const user = await db.user.create({ data: { email: `${tag}-doctor${i}@example.test`, role: 'DOCTOR', passwordHash: hash } });
      const doc = await db.doctor.create({ data: { userId:user.id, firstName:`طبيب${i+1}`, lastName:'اختبار', wilayaId, cityId, specialtyId, slotDurationMin:i<5?5:10, verificationStatus:'VERIFIED', subscriptionStatus:'ACTIVE', schedules:{create:Array.from({length:7},(_,dayOfWeek)=>({dayOfWeek,startTime:'08:00',endTime:'20:00'}))} } });
      doctors.push({...actor(user.id,'DOCTOR',user.email,`192.0.2.${i+1}`), doctorId:doc.id});
      const assistant = await db.user.create({data:{email:`${tag}-assistant${i}@example.test`,role:'ASSISTANT',passwordHash:hash,assistant:{create:{doctorId:doc.id,firstName:`مساعد${i+1}`,lastName:'اختبار'}}}});
      assistants.push({...actor(assistant.id,'ASSISTANT',assistant.email,`192.0.2.${i+1}`), doctorId:doc.id});
    }
    for(let i=0;i<1000;i++) {
      const id=randomUUID(), patientId=randomUUID(), email=`${tag}-p${i}@example.test`;
      patients.push({...actor(id,'PATIENT',email,`198.18.${Math.floor(i/250)}.${i%250+1}`),patientId});
    }
    await db.user.createMany({data:patients.map(p=>({id:p.id,email:p.email,role:'PATIENT',passwordHash:hash}))});
    await db.patient.createMany({data:patients.map((p,i)=>({id:p.patientId!,userId:p.id,firstName:'مريض',lastName:`اختبار${i}`}))});
    const { algeriaTodayUTCMidnight } = await import('../../src/lib/slots');
    today = algeriaTodayUTCMidnight();
    date = new Date(today.getTime()+86400000).toISOString().slice(0,10);
    report.bookingDate=date;
    const { createApp }=await import('../../src/app');
    server=http.createServer(createApp());
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // Exercise actual password login for every staff account and a patient sample.
    for(const a of [...doctors,...assistants,...patients.slice(0,15)]) {
      const r=await call(a,'login',a.role==='PATIENT'?'/api/patient/auth/login':'/api/auth/login','POST',{email:a.email,password});
      if(r.status===200 && r.data?.accessToken) a.token=r.data.accessToken;
      else violations.push(`Login failed for ${a.role}`);
    }
  },180000);

  afterAll(async () => {
    running=false;
    if(server) { server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())); }
    if(db) await db.$disconnect();
    if(base) { const {prisma}=await import('../../src/lib/prisma'); await prisma.$disconnect(); }
  });

  it('keeps bookings, ownership and queues consistent through ramp and peak load', async () => {
    const start=performance.now();
    running=true;
    async function poll(a:Actor) {
      let cycle=0;
      while(running) {
        await call(a,`${a.role}.queue`,'/api/appointments/queue');
        const appts=await call(a,`${a.role}.appointments`,'/api/appointments');
        if(appts.status===200 && appts.data.some((x:any)=>x.doctorId!==a.doctorId)) violations.push('Cross-clinic appointment leak');
        if(cycle%2===0) {
          const dashboard=await call(a,`${a.role}.dashboard`,'/api/doctor/dashboard');
          if(a.role==='ASSISTANT' && dashboard.data && ('estimatedRevenueMonth' in dashboard.data || 'estimatedRevenue' in dashboard.data)) violations.push('Assistant financial data leak');
          await call(a,`${a.role}.notifications`,'/api/notifications');
        }
        cycle++;
        // 10 seconds matches queue polling; appointments/dashboard are slightly
        // more frequent here than the UI (15/30s), making this conservative.
        for(let n=0;n<100 && running;n++) await pause(100);
      }
    }
    const polling=[...doctors,...assistants].map(poll);
    const tasks:number[]=[];
    for(let n=0;n<100;n++) for(let d=0;d<15;d++) if(n<quotas[d]) tasks.push(d);
    const booked:{id:string;patientIndex:number;doctorIndex:number}[]=[];
    try {
      let offset=0;
      for(const [count,concurrency] of [[100,5],[300,20],[600,50]]) {
        const phaseStart=performance.now(), phaseSamples=samples.length;
        let next=offset;
        await Promise.all(Array.from({length:concurrency},async()=>{
          while(next<offset+count) {
            const i=next++, d=tasks[i], a=patients[i];
            await call(a,'patient.availability',`/api/booking/availability?doctorId=${doctors[d].doctorId}&date=${date}`);
            const r=await call(a,'patient.booking','/api/booking','POST',{firstName:'مريض',lastName:`اختبار${i}`,wilayaId,specialtyId,doctorId:doctors[d].doctorId,date},[201]);
            if(r.status===201) booked.push({id:r.data.id,patientIndex:i,doctorIndex:d});
            const mine=await call(a,'patient.account','/api/patient/account/appointments');
            if(mine.status===200 && (mine.data.length!==(r.status===201?1:0) || (r.status===201 && !mine.data.some((x:any)=>x.id===r.data.id && x.doctor.id===doctors[d].doctorId)))) violations.push('Patient ownership / missing booking');
            await pause(50);
          }
        }));
        (report.phases??=[]).push({bookings:count,concurrency,elapsedMs:Math.round(performance.now()-phaseStart),requests:samples.length-phaseSamples});
        offset+=count;
      }
      const rows=await db.appointment.findMany({where:{date:new Date(date+'T00:00:00Z')}});
      report.bookings={successful:booked.length,rows:rows.length,perDoctor:doctors.map((d,i)=>({doctor:i+1,expected:quotas[i],actual:rows.filter(r=>r.doctorId===d.doctorId).length})),duplicates:rows.length-new Set(rows.map(r=>`${r.doctorId}/${r.startTime}`)).size,lost:booked.filter(b=>!rows.some(r=>r.id===b.id)).length};
      for(const b of booked) {
        const row=rows.find(r=>r.id===b.id);
        if(row && (row.doctorId!==doctors[b.doctorIndex].doctorId || row.patientId!==patients[b.patientIndex].patientId)) violations.push('Booking identity mismatch');
      }
      // Queue fixtures are separately identified and excluded from 1000 bookings.
      // Keep today's fixture open regardless of wall clock time.
      await db.doctorSchedule.createMany({data:doctors.map(d=>({doctorId:d.doctorId!,dayOfWeek:today.getUTCDay(),isException:true,exceptionDate:today,startTime:'00:00',endTime:'23:59'}))});
      await db.appointment.createMany({data:doctors.flatMap((d,i)=>Array.from({length:3},(_,n)=>({doctorId:d.doctorId!,patientId:patients[i*3+n].patientId,date:today,startTime:`0${n+1}:00`,endTime:`0${n+1}:05`,status:'CONFIRMED' as const})))});
      const raceResults=await Promise.all(doctors.map(async(d,i)=>{
        const pair=await Promise.all([d,assistants[i]].map(a=>call(a,'queue.race','/api/appointments/queue/next','POST',{},[200,400])));
        const active=await db.appointment.findMany({where:{doctorId:d.doctorId,date:today,status:'IN_PROGRESS'}});
        if(pair.filter(r=>r.status===200).length!==1 || active.length!==1) violations.push('Double call in one clinic');
        const foreign=await call(assistants[(i+1)%15],'assistant.foreign',`/api/appointments/${active[0]?.id}`,'PATCH',{status:'COMPLETED'},[403]);
        if(active.length) await call(assistants[i],'assistant.completeDenied',`/api/appointments/${active[0].id}`,'PATCH',{status:'COMPLETED'},[400]);
        const done=active.length?await call(d,'doctor.complete',`/api/appointments/${active[0].id}`,'PATCH',{status:'COMPLETED'}):null;
        return {doctor:i+1,statuses:pair.map(r=>r.status),active:active.length,foreign:foreign.status,completed:done?.status};
      }));
      report.queueRaces=raceResults;
      // The appointment screen has a second call path: PATCH IN_PROGRESS.
      // It must share the same one-patient-inside guard as queue/next.
      report.patchRaces=await Promise.all(doctors.map(async(d,i)=>{
        const waiting=await db.appointment.findMany({where:{doctorId:d.doctorId,date:today,status:'CONFIRMED'},orderBy:{startTime:'asc'}});
        const pair=await Promise.all([d,assistants[i]].map((a,n)=>call(a,'queue.patchRace',`/api/appointments/${waiting[n].id}`,'PATCH',{status:'IN_PROGRESS'},[200,400,409])));
        const active=await db.appointment.count({where:{doctorId:d.doctorId,date:today,status:'IN_PROGRESS'}});
        if(pair.filter(r=>r.status===200).length!==1 || active!==1) violations.push('PATCH allows multiple patients inside one clinic');
        return {doctor:i+1,statuses:pair.map(r=>r.status),active};
      }));
      const selected=booked.filter((_,i)=>i%40===0);
      for(const b of selected) {
        await call(patients[(b.patientIndex+1)%1000],'patient.foreign',`/api/appointments/${b.id}`,'DELETE',undefined,[403]);
        await call(patients[b.patientIndex],'patient.cancel',`/api/appointments/${b.id}`,'DELETE');
      }
      report.cancelled=await db.appointment.count({where:{date:new Date(date+'T00:00:00Z'),status:'CANCELLED',activeSlot:null}});
      report.unexpectedResponses=samples.filter(s=>!s.expected);
      report.violations=violations;
      expect(booked).toHaveLength(1000);
      expect(rows).toHaveLength(1000);
      expect(report.bookings.duplicates).toBe(0);
      expect(report.bookings.lost).toBe(0);
      for(const d of report.bookings.perDoctor) expect(d.actual).toBe(d.expected);
      expect(report.cancelled).toBe(selected.length);
      expect(violations).toEqual([]);
      expect(report.unexpectedResponses).toEqual([]);
    } finally {
      running=false;
      await Promise.all(polling);
      report.elapsedMs=Math.round(performance.now()-start);
      report.requests=samples.length;
      report.metrics=Object.fromEntries([...new Set(samples.map(s=>s.operation))].map(op=>{
        const group=samples.filter(s=>s.operation===op), times=group.map(s=>s.ms).sort((a,b)=>a-b);
        return [op,{count:group.length,p50:times[Math.ceil(times.length*.5)-1],p95:times[Math.ceil(times.length*.95)-1],p99:times[Math.ceil(times.length*.99)-1],max:times.at(-1),unexpected:group.filter(s=>!s.expected).length,statuses:group.reduce((acc,s)=>({...acc,[s.status]:(acc[s.status]??0)+1}),{} as Record<number,number>)}];
      }));
      report.unexpectedResponses=samples.filter(s=>!s.expected);
      report.violations=violations;
      if(process.env.CLINIC_LOAD_REPORT) fs.writeFileSync(process.env.CLINIC_LOAD_REPORT,JSON.stringify(report,null,2));
      console.log('CLINIC_LOAD_REPORT '+JSON.stringify(report));
    }
  },600000);
});
