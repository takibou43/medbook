import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus } from "lucide-react";
import { api, apiErrorMessage } from "../../lib/api";
import { Spinner, EmptyState } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";

export default function AdminSpecialties() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-specialties"],
    queryFn: async () => (await api.get("/admin/specialties")).data.data,
  });
  const { showToast } = useToast();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [nameAr, setNameAr] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!nameAr.trim()) return showToast("اسم التخصص مطلوب.", "error");
    setSaving(true);
    try {
      await api.post("/admin/specialties", { nameAr, description: description || undefined });
      showToast("تمت الإضافة.", "success");
      setOpen(false);
      setNameAr("");
      setDescription("");
      qc.invalidateQueries({ queryKey: ["admin-specialties"] });
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("حذف هذا التخصص؟")) return;
    try {
      await api.delete(`/admin/specialties/${id}`);
      showToast("تم الحذف.", "success");
      qc.invalidateQueries({ queryKey: ["admin-specialties"] });
    } catch (err) {
      showToast(apiErrorMessage(err), "error");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-slate-900">إدارة التخصصات</h1>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          إضافة تخصص
        </Button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : data && data.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((s: any) => (
            <div key={s.id} className="card flex items-center justify-between p-4">
              <div>
                <p className="font-bold text-slate-800">{s.nameAr}</p>
                {s.description && <p className="text-xs text-slate-500">{s.description}</p>}
              </div>
              <button onClick={() => remove(s.id)} className="rounded-lg p-2 text-red-500 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="لا توجد تخصصات" />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="إضافة تخصص جديد"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={create} loading={saving}>
              إضافة
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="اسم التخصص" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          <Input label="الوصف (اختياري)" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
