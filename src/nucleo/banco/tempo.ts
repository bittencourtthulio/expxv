/** UTC ISO 8601 com milissegundos (ex.: 2026-01-02T03:04:05.006Z). Único formato de data do banco. */
export function agora(data: Date = new Date()): string {
  return data.toISOString();
}
