export function readError(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
