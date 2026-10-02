// Tipos só de teste: transforma uma API em "a mesma API com cada método espionável" (vi.fn), sem perder a tipagem do contrato.
import type { Mock } from "vitest";

export type Falso<T> = { [K in keyof T]: T[K] extends (...args: infer P) => infer R ? Mock<(...args: P) => R> : T[K] };
