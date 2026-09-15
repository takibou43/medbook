import { useCallback, useState } from "react";

export type LocationStatus = "idle" | "locating" | "granted" | "denied" | "unsupported";

/**
* موقع المريض عبر Browser Geolocation فقط — لا يُطلب الإذن إلا عند استدعاء request()
* صراحةً (بضغط زر)، ولا يُخزَّن الموقع في أي مكان (لا localStorage ولا قاعدة بيانات):
* يعيش فقط في حالة هذا المكوّن طوال الجلسة الحالية، ويُستعمل فقط لحساب المسافة والترتيب.
*/
export function useGeolocation() {
  const [status, setStatus] = useState<LocationStatus>("idle");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

const request = useCallback(() => {
  if (!navigator.geolocation) {
    setStatus("unsupported");
    return;
  }
  setStatus("locating");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setStatus("granted");
    },
    () => {
      setStatus("denied");
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
}, []);

const dismiss = useCallback(() => setStatus("denied"), []);

return { status, coords, request, dismiss };
}
