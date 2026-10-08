import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

/** Keep list state in the URL so reload and browser history restore it. */
export function useAdminListParams() {
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  const [q, setQ] = useState(search);
  const pageValue = Number(params.get("page"));
  const page = Number.isInteger(pageValue) && pageValue >= 1 && pageValue <= 1000 ? pageValue : 1;
  useEffect(() => { setQ(search); }, [search]);
  useEffect(() => {
    if (q.trim() === search) return;
    const timer = setTimeout(() => setParams((old) => {
      const next = new URLSearchParams(old);
      if (q.trim()) next.set("q", q.trim()); else next.delete("q");
      next.delete("page");
      next.delete("id");
      return next;
    }, { replace: true }), 300);
    return () => clearTimeout(timer);
  }, [q, search, setParams]);
  function update(key: string, value: string) {
    setParams((old) => {
      const next = new URLSearchParams(old);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== "page") { next.delete("page"); next.delete("id"); }
      return next;
    });
  }
  function clear() {
    setQ("");
    setParams((old) => {
      const next = new URLSearchParams(old);
      ["q", "page", "id", "filter", "status", "role"].forEach((key) => next.delete(key));
      return next;
    });
  }
  return { clear, params, q, setQ, search, page, setPage: (value: number) => update("page", String(value)), update };
}
