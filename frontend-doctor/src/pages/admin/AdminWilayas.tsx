import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";

export default function AdminWilayas() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-wilayas"],
    queryFn: async () => (await api.get("/admin/wilayas")).data.data,
  });
  const { showToast } = useToast();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [cityModal, setCityModal] = useState<string | null>(null);
  const [cityName, setCityName] = useState("");
  const [saving, setSaving] = useState(false);

  async function createWilaya() {
    if (!code || !nameAr) return showToast("الرمز والاسم مطلوبان.", "error");
    setSaving(true);
    try {
      await api.post("/admin/wilayas", { code, nameAr });
      showToast("تمت الإضافة.", "success");
      setOpen(false);
      setCode("");
      setNameAr("");
      qc.invalidateQueries({ queryKey: ["admin-wilayas"] });
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function removeWilaya(id: string) {
    if (!confirm("حذف هذه الولاية وكل بلدياتها؟")) return;
    try {
      await api.delete(`/admin/wilayas/${id}`);
      showToast("تم الحذف.", "success");
      qc.invalidateQueries({ queryKey: ["admin-wilayas"] });
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    }
  }

  async function addCity() {
    if (!cityModal || !cityName.trim()) return;
    try {
      await api.post(`/admin/wilayas/${cityModal}/cities`, { nameAr: cityName });
      showToast("تمت إضافة البلدية.", "success");
      setCityName("");
      setCityModal(null);
      qc.invalidateQueries({ queryKey: ["admin-wilayas"] });
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    }
  }

  async function removeCity(id: string) {
    try {
      await api.delete(`/admin/cities/${id}`);
      qc.invalidateQueries({ queryKey: ["admin-wilayas"] });
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-slate-900">إدارة الولايات والبلديات</h1>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          إضافة ولاية
        </Button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : data && data.length > 0 ? (
        <div className="space-y-3">
          {data.map((w: any) => (
            <div key={w.id} className="card p-4">
              <div className="flex items-center justify-between">
                <p className="font-bold text-slate-800">
                  {w.code} — {w.nameAr}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setCityModal(w.id)}>
                    <Plus className="h-4 w-4" />
                    بلدية
                  </Button>
                  <Button variant="danger" onClick={() => removeWilaya(w.id)}>
                    حذف
                  </Button>
                </div>
              </div>
              {w.cities?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {w.cities.map((c: any) => (
                    <span key={c.id} className="badge flex items-center gap-1 bg-slate-100 text-slate-700">
                      {c.nameAr}
                      <button onClick={() => removeCity(c.id)}>
                        <Trash2 className="h-3 w-3 text-red-500" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="لا توجد ولايات" />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="إضافة ولاية"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={createWilaya} loading={saving}>
              إضافة
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="الرمز (مثال: 16)" value={code} onChange={(e) => setCode(e.target.value)} />
          <Input label="اسم الولاية" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </div>
      </Modal>

      <Modal
        open={!!cityModal}
        onClose={() => setCityModal(null)}
        title="إضافة بلدية"
        footer={
          <>
            <Button variant="outline" onClick={() => setCityModal(null)}>
              إلغاء
            </Button>
            <Button onClick={addCity}>إضافة</Button>
          </>
        }
      >
        <Input label="اسم البلدية" value={cityName} onChange={(e) => setCityName(e.target.value)} />
      </Modal>
    </div>
  );
}
