import { beforeEach, describe, expect, it, vi } from "vitest";
const db=vi.hoisted(()=>({doctor:{findUnique:vi.fn()},appointment:{findMany:vi.fn(),groupBy:vi.fn(),count:vi.fn()},review:{aggregate:vi.fn()}}));
vi.mock('../src/lib/prisma',()=>({prisma:db}));
vi.mock('../src/lib/actingDoctor',()=>({resolveActingDoctorId:vi.fn(async()=> 'doctor-1')}));
import { listForDoctor } from '../src/modules/appointments/appointments.service';
import { getDashboardStats, getOwnPatients, replaceWeeklySchedule } from '../src/modules/doctors/doctorSelf.service';

const base={date:new Date('2026-10-02T00:00:00Z'),startTime:'09:00',status:'NO_SHOW',guestPhone:null,guestFirstName:null,guestLastName:null,patientId:'p1',familyMemberId:null,patient:{firstName:'Sara',lastName:'Demo',user:{email:null,phone:'0550000000'}},familyMember:null};
const rows=[{...base,id:'a1'},{...base,id:'a2',familyMemberId:'f1',familyMember:{id:'f1',firstName:'Ali',lastName:'Demo',relationship:'CHILD'}},{...base,id:'a3',patientId:null,patient:null,guestFirstName:'Sara',guestPhone:'0550000000'},{...base,id:'a4',patientId:null,patient:null,guestFirstName:'Ali',guestPhone:'0550000000'}];
beforeEach(()=>{
 vi.clearAllMocks();
 db.doctor.findUnique.mockImplementation(async ({select}:any)=>select?.schedules?null:{id:'doctor-1',verificationStatus:'VERIFIED',consultationFee:1000});
 db.appointment.findMany.mockResolvedValue(rows);
 db.appointment.count.mockResolvedValue(0);
 db.review.aggregate.mockResolvedValue({_avg:{rating:null},_count:{_all:0}});
 db.appointment.groupBy.mockResolvedValue([{patientId:'p1',familyMemberId:null,_count:{_all:1}},{patientId:'p1',familyMemberId:'f1',_count:{_all:5}}]);
});
describe('doctor identity aggregation (mocked DB only)',()=>{
 it('absence badges stay beneficiary-specific, doctor-scoped and never phone-derived',async()=>{
  const result=await listForDoctor('doctor-user','DOCTOR');
  expect(result.map(a=>a.patientNoShowCount)).toEqual([1,5,0,0]);
  expect(db.appointment.groupBy).toHaveBeenCalledWith({by:['patientId','familyMemberId'],where:{doctorId:'doctor-1',patientId:{in:['p1']},status:'NO_SHOW'},_count:{_all:true}});
 });
 it('dashboard and patient list counts match including family and unverified guest records',async()=>{
  const stats=await getDashboardStats('doctor-user','DOCTOR');
  const patients:any=await getOwnPatients('doctor-user',{paged:true,page:1});
  expect(stats.totalPatients).toBe(4);expect(patients.total).toBe(stats.totalPatients);
 });
 it('assistant response still omits patient totals and monthly financial data',async()=>{
  const stats=await getDashboardStats('assistant-user','ASSISTANT');
  expect(stats).not.toHaveProperty('totalPatients');expect(stats).not.toHaveProperty('estimatedRevenueMonth');
 });
 it('invalid weekly schedule is rejected before reading or writing DB',async()=>{
  await expect(replaceWeeklySchedule('doctor-user',[{dayOfWeek:0,startTime:'12:00',endTime:'08:00'}])).rejects.toMatchObject({statusCode:400});
  expect(db.doctor.findUnique).not.toHaveBeenCalled();expect(db.appointment.findMany).not.toHaveBeenCalled();
 });
});
