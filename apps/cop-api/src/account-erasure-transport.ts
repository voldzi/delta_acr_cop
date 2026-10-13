import type { FastifyRequest } from "fastify";
export const ERASURE_RECEIPT_HEADER = "x-cop-erasure-receipt-capability";
export const ERASURE_RECEIPT_COOKIE = "__Secure-cop_erasure_receipt_v1";
export function isAccountErasureReceiptRead(request: Pick<FastifyRequest, "method" | "url">): boolean {
  return request.method === "GET" && /^\/api\/v1\/me\/account-deletion\/receipts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(request.url);
}
export function erasureCapabilityFrom(request: FastifyRequest): string {
  const header = request.headers[ERASURE_RECEIPT_HEADER];
  if (typeof header === "string") return header;
  const cookie = request.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith(ERASURE_RECEIPT_COOKIE + "="));
  return cookie?.slice(ERASURE_RECEIPT_COOKIE.length + 1) ?? "";
}
