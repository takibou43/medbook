import { ApiError } from "../utils/ApiError";

/**
 * Structural bounds checked before Zod parses request input.
 *
 * Zod 3 validates every array element even when the schema has `.max(n)`, and records
 * one issue per failing element. A 2MB JSON body such as `{"languages":[0,0,0,...]}`
 * therefore allocated ~300MB of issue objects and produced a ~30MB error response on
 * public routes (e.g. doctor registration) — enough to exhaust the free Render instance.
 * The largest legitimate array today is 1000 doctor IDs; nesting stays below 10 levels.
 */
export const MAX_INPUT_ARRAY_ITEMS = 1000;
export const MAX_INPUT_DEPTH = 32;
export const MAX_INPUT_NODES = 50_000;

const TOO_LARGE = "بنية الطلب أكبر من الحد المسموح.";

export function assertBoundedInput(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  const stack: Array<{ v: object; d: number }> = [{ v: value as object, d: 1 }];
  let nodes = 0;
  while (stack.length > 0) {
    const { v, d } = stack.pop()!;
    if (d > MAX_INPUT_DEPTH) throw ApiError.badRequest(TOO_LARGE);
    const children: unknown[] = Array.isArray(v) ? v : Object.values(v);
    if (Array.isArray(v) && v.length > MAX_INPUT_ARRAY_ITEMS) throw ApiError.badRequest(TOO_LARGE);
    nodes += children.length;
    if (nodes > MAX_INPUT_NODES) throw ApiError.badRequest(TOO_LARGE);
    for (const child of children) {
      if (child !== null && typeof child === "object") stack.push({ v: child as object, d: d + 1 });
    }
  }
}
