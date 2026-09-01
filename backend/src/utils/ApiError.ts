export class ApiError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, message, details);
  }
  static unauthorized(message = "غير مصرح. الرجاء تسجيل الدخول.") {
    return new ApiError(401, message);
  }
  static forbidden(message = "ليست لديك صلاحية للقيام بهذا الإجراء.") {
    return new ApiError(403, message);
  }
  static notFound(message = "العنصر المطلوب غير موجود.") {
    return new ApiError(404, message);
  }
  static conflict(message: string, details?: unknown) {
    return new ApiError(409, message, details);
  }
}
