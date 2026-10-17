/** ترميز HTML للقيم المحقونة في صفحات تُبنى كنص (نوافذ الطباعة): يمنع تنفيذ أي وسوم/سمات يكتبها المستخدم. */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
