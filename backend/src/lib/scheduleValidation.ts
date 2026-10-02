export function weeklyScheduleError(blocks: {dayOfWeek:number;startTime:string;endTime:string}[]): string | null {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const block of blocks) {
    if (!Number.isInteger(block.dayOfWeek) || block.dayOfWeek < 0 || block.dayOfWeek > 6 || !time.test(block.startTime) || !time.test(block.endTime) || block.endTime <= block.startTime) return "نهاية فترة العمل يجب أن تكون بعد بدايتها، بأوقات صحيحة في اليوم نفسه.";
  }
  for (let day=0; day<7; day++) {
    const periods=blocks.filter(b=>b.dayOfWeek===day).sort((a,b)=>a.startTime.localeCompare(b.startTime));
    for(let i=1;i<periods.length;i++) if(periods[i-1].endTime>periods[i].startTime) return "لا يمكن حفظ فترات عمل متداخلة في اليوم نفسه.";
  }
  return null;
}
