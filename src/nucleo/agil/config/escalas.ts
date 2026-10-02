import type { EscalaAgil } from "../../../compartilhado/agil";

const v = (rotulo: string, valor: number) => ({ rotulo, valor });
export const ESCALAS: readonly EscalaAgil[] = [
  { id: "fibonacci", nome: "Fibonacci", valores: [1, 2, 3, 5, 8, 13, 21].map((n) => v(String(n), n)) },
  { id: "camisetas", nome: "Camisetas", valores: [v("PP", 1), v("P", 2), v("M", 3), v("G", 5), v("GG", 8)] },
  { id: "horas", nome: "Horas", valores: [1, 2, 4, 8, 16, 24, 40].map((n) => v(`${n}h`, n)) },
];
