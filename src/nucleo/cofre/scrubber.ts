// Scrubber: remove de qualquer texto (brief, checkpoint, relatório exibido, diagnóstico, log, erro) o valor literal dos
// segredos conhecidos e as variantes (base64, base64url, URL-encode, escape de JSON, hex). Vira `«cofre:NOME»`.
// Só guarda valores em memória enquanto o cofre está aberto (o cofre limpa ao bloquear).

/** Valores menores que isto não são removidos (estragariam texto comum); chaves reais têm bem mais. */
export const MIN_SCRUB = 6;

export interface Scrubber {
  adicionar(nome: string, valor: string): void;
  remover(nome: string): void;
  limpar(): void;
  scrub(texto: string): string;
  /** nomes com valor conhecido (para diagnóstico; nunca os valores). */
  nomes(): string[];
  tamanho(): number;
}

function variantes(valor: string): string[] {
  const b = Buffer.from(valor, "utf8");
  const b64 = b.toString("base64");
  const todas = new Set<string>([
    valor,
    b64,
    b64.replace(/=+$/, ""),
    b.toString("base64url"),
    encodeURIComponent(valor),
    JSON.stringify(valor).slice(1, -1),
    b.toString("hex"),
  ]);
  return [...todas].filter((v) => v.length >= MIN_SCRUB);
}

export function criarScrubber(): Scrubber {
  const porNome = new Map<string, string[]>();
  let ordenadas: Array<{ v: string; nome: string }> = [];
  const reconstruir = (): void => {
    ordenadas = [];
    for (const [nome, vs] of porNome) for (const v of vs) ordenadas.push({ v, nome });
    ordenadas.sort((a, b) => b.v.length - a.v.length);
  };
  return {
    adicionar(nome, valor) {
      if (valor.length < MIN_SCRUB) return;
      porNome.set(nome, variantes(valor));
      reconstruir();
    },
    remover(nome) {
      if (porNome.delete(nome)) reconstruir();
    },
    limpar() {
      porNome.clear();
      ordenadas = [];
    },
    scrub(texto) {
      if (ordenadas.length === 0 || texto.length === 0) return texto;
      let t = texto;
      for (const { v, nome } of ordenadas) {
        if (t.includes(v)) t = t.split(v).join(`«cofre:${nome}»`);
      }
      return t;
    },
    nomes: () => [...porNome.keys()],
    tamanho: () => porNome.size,
  };
}

/** Máscara de exibição: nunca revela o valor; só os 4 últimos caracteres e só se o valor for longo (≥ 16). */
export function mascarar(valor: string): string {
  return valor.length >= 16 ? `••••${valor.slice(-4)}` : "••••";
}
