/**
 * حساب المسافة بين نقطتين جغرافيتين (طبيب/عيادة والمريض) — صيغة Haversine.
 * مجانية بالكامل، بلا أي خدمة أو API خارجي مدفوع.
 */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const toRad = (v: number) => (v * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

export function roundDistanceKm(km: number): number {
    return Math.round(km * 10) / 10;
}
