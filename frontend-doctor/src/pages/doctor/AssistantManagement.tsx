import { useState } from "react";
import { useForm } from "react-hook-form";
import { Copy, RefreshCcw, Ban, UserCog, Power, Link as LinkIcon } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Spinner, EmptyState } from "../../components/ui/States";
import { InviteStatusBadge, AssistantActiveBadge } from "../../components/ui/Badge";
import { useToast } from "../../components/ui/Toast";
import { apiErrorMessage } from "../../lib/api";
import {
  useAssistantsList,
  useInviteAssistant,
  useResendInvite,
  useRevokeInvite,
  useSetAssistantActive,
} from "../../hooks/useAssistants";

interface InviteForm {
  email: string;
}

/** رابط دعوة كامل قابل للنسخ والإرسال يدويًا للمساعد (لا يُرسَل بريد تلقائيًا). */
function inviteLink(token: string): string {
  return `${window.location.origin}/assistant/accept/${token}`;
}

async function copyToClipboard(text: string, showToast: (m: string, k?: "success" | "error" | "info") => void) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("تم نسخ رابط الدعوة.", "success");
  } catch {
    showToast("تعذّر نسخ الرابط.", "error");
  }
}

export default function AssistantManagement() {
  const { showToast } = useToast();
  const { data, isLoading } = useAssistantsList();
  const invite = useInviteAssistant();
  const resend = useResendInvite();
  const revoke = useRevokeInvite();
  const setActive = useSetAssistantActive();
  const [busyId, setBusyId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteForm>();

  async function onInvite(values: InviteForm) {
    try {
      const result = await invite.mutateAsync(values.email);
      reset();
      showToast("تم إنشاء رابط الدعوة. انسخه وأرسله للمساعد.", "success");
      await copyToClipboard(inviteLink(result.token), showToast);
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر إنشاء الدعوة."), "error");
    }
  }

  async function onResend(id: string) {
    setBusyId(id);
    try {
      const result = await resend.mutateAsync(id);
      showToast("تم تجديد رابط الدعوة.", "success");
      await copyToClipboard(inviteLink(result.token), showToast);
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر تجديد الدعوة."), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function onRevoke(id: string) {
    setBusyId(id);
    try {
      await revoke.mutateAsync(id);
      showToast("تم إلغاء الدعوة.", "success");
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر إلغاء الدعوة."), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function onToggleActive(id: string, next: boolean) {
    setBusyId(id);
    try {
      await setActive.mutateAsync({ id, isActive: next });
      showToast(next ? "تم تفعيل وصول المساعد." : "تم تعطيل وصول المساعد فورًا.", "success");
    } catch (err) {
      showToast(apiErrorMessage(err, "تعذّر تغيير حالة المساعد."), "error");
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading) return <Spinner />;

  const assistants = data?.assistants ?? [];
  const invites = data?.invites ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">إدارة المساعدين</h1>
        <p className="mt-1 text-sm text-slate-500">
          ادعُ مساعدًا لمتابعة طابور اليوم والمواعيد نيابةً عنك. يرى المساعد فقط دخل اليوم — لا يرى دخلك الشهري ولا
          إعدادات حسابك ولا يمكنه إضافة مساعدين آخرين.
        </p>
      </div>

      {/* دعوة مساعد جديد */}
      <Card>
        <h2 className="mb-3 flex items-center gap-1.5 font-bold text-slate-800">
          <UserCog className="h-4 w-4" /> دعوة مساعد جديد
        </h2>
        <form onSubmit={handleSubmit(onInvite)} className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1">
            <Input
              type="email"
              placeholder="بريد المساعد الإلكتروني"
              error={errors.email?.message}
              {...register("email", { required: "البريد الإلكتروني مطلوب" })}
            />
          </div>
          <Button type="submit" loading={invite.isPending} className="shrink-0">
            إنشاء رابط الدعوة
          </Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          سينشئ هذا رابط دعوة صالحًا لمدة 7 أيام ومرتبطًا بهذا البريد فقط، ويُنسخ تلقائيًا إلى الحافظة لإرساله يدويًا
          (واتساب، بريد إلكتروني...).
        </p>
      </Card>

      {/* الدعوات المعلّقة/المنتهية */}
      {invites.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold text-slate-700">الدعوات المعلّقة</p>
          <div className="space-y-2">
            {invites.map((inv) => (
              <Card key={inv.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800">{inv.email}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    تنتهي صلاحيتها في {new Date(inv.expiresAt).toLocaleDateString("ar-DZ")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <InviteStatusBadge status={inv.status} />
                  {inv.status !== "REVOKED" && (
                    <>
                      <button
                        type="button"
                        disabled={busyId === inv.id}
                        onClick={() => onResend(inv.id)}
                        title="تجديد الرابط ونسخه"
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary-600 transition hover:bg-primary-50 disabled:opacity-40"
                      >
                        <RefreshCcw className="h-3.5 w-3.5" /> تجديد
                      </button>
                      <button
                        type="button"
                        disabled={busyId === inv.id}
                        onClick={() => onRevoke(inv.id)}
                        title="إلغاء الدعوة"
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-40"
                      >
                        <Ban className="h-3.5 w-3.5" /> إلغاء
                      </button>
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* المساعدون الحاليون */}
      <div>
        <p className="mb-2 text-sm font-bold text-slate-700">المساعدون ({assistants.length})</p>
        {assistants.length === 0 ? (
          <EmptyState title="لا يوجد مساعدون بعد" description="أرسل دعوة لبريد المساعد أعلاه لبدء إضافته." />
        ) : (
          <div className="space-y-2">
            {assistants.map((a) => (
              <Card key={a.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800">
                    {a.firstName} {a.lastName}
                  </p>
                  <p className="truncate text-xs text-slate-500" dir="ltr">
                    {a.user.email}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <AssistantActiveBadge isActive={a.isActive} />
                  <button
                    type="button"
                    disabled={busyId === a.id}
                    onClick={() => onToggleActive(a.id, !a.isActive)}
                    title={a.isActive ? "تعطيل وصول هذا المساعد فورًا" : "إعادة تفعيل وصول هذا المساعد"}
                    className={
                      "flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition disabled:opacity-40 " +
                      (a.isActive ? "text-red-600 hover:bg-red-50" : "text-green-700 hover:bg-green-50")
                    }
                  >
                    <Power className="h-3.5 w-3.5" /> {a.isActive ? "تعطيل" : "تفعيل"}
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-slate-400">
        <LinkIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        رابط الدعوة يظهر مرة واحدة فقط عند الإنشاء أو التجديد وينسخ تلقائيًا للحافظة — إن ضاع، جدّد الدعوة لإنشاء رابط
        جديد.
      </p>
    </div>
  );
}
