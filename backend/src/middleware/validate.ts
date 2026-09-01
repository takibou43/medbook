import { NextFunction, Request, Response } from "express";
import { AnyZodObject } from "zod";

type Schemas = Partial<{ body: AnyZodObject; query: AnyZodObject; params: AnyZodObject }>;

/** يتحقق من body/query/params باستخدام Zod ويرمي 400 موحّد الشكل عند الفشل (تُعالج في errorHandler). */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (schemas.body) req.body = schemas.body.parse(req.body);
    if (schemas.query) req.query = schemas.query.parse(req.query) as any;
    if (schemas.params) req.params = schemas.params.parse(req.params) as any;
    next();
  };
}
