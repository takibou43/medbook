import { useEffect, useState } from "react";
import { onPrescriptionFolderChanged, readPrescriptionFolder, type PrescriptionFolder } from "../lib/prescriptionFolder";

export function usePrescriptionFolder(uid: string) {
  const [state, setState] = useState<{ uid: string; folder: PrescriptionFolder | null; error: boolean; loading: boolean }>({ uid, folder: null, error: false, loading: true });
  useEffect(() => {
    let active = true;
    const load = () => {
      if (!uid) { setState({ uid, folder: null, error: false, loading: false }); return; }
      readPrescriptionFolder(uid).then(folder => { if (active) setState({ uid, folder, error: false, loading: false }); })
        .catch(() => { if (active) setState({ uid, folder: null, error: true, loading: false }); });
    };
    load();
    const unsubscribe = onPrescriptionFolderChanged(load);
    return () => { active = false; unsubscribe(); };
  }, [uid]);
  return state.uid === uid ? state : { uid, folder: null, error: false, loading: true };
}
