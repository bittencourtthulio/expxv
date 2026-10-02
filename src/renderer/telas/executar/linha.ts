// Edição de comando no diálogo: "npm run build -- --flag 'com espaço'" ⇄ lista de argumentos. NUNCA vai a shell: o resultado é só uma lista
// (o main revalida cada campo). Aspas simples e duplas e barra invertida; aspa aberta e sem fechar é erro, não adivinhação.

export type ResultadoLinha = { ok: true; argumentos: string[] } | { ok: false; erro: string };

export function dividirLinha(linha: string): ResultadoLinha {
  const saida: string[] = [];
  let atual = "";
  let temAtual = false;
  let aspa: "'" | '"' | null = null;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i]!;
    if (aspa !== null) {
      if (c === aspa) { aspa = null; continue; }
      if (c === "\\" && aspa === '"' && i + 1 < linha.length && /["\\$`]/.test(linha[i + 1]!)) { atual += linha[i + 1]; i += 1; continue; }
      atual += c;
      continue;
    }
    if (c === "'" || c === '"') { aspa = c; temAtual = true; continue; }
    if (c === "\\" && i + 1 < linha.length) { atual += linha[i + 1]; temAtual = true; i += 1; continue; }
    if (/\s/.test(c)) { if (temAtual) { saida.push(atual); atual = ""; temAtual = false; } continue; }
    atual += c;
    temAtual = true;
  }
  if (aspa !== null) return { ok: false, erro: "aspas abertas sem fechar" };
  if (temAtual) saida.push(atual);
  return { ok: true, argumentos: saida };
}

const SIMPLES = /^[A-Za-z0-9_@%+=:,./-]+$/;
export const citar = (a: string): string => (a === "" ? "''" : SIMPLES.test(a) ? a : `'${a.replaceAll("'", "'\\''")}'`);
export const juntarLinha = (args: readonly string[]): string => args.map(citar).join(" ");

/** `KEY=valor` por linha; linha vazia ou `#` é ignorada; erro cita a linha. */
export function lerAmbiente(texto: string): { ok: true; ambiente: Record<string, string> } | { ok: false; erro: string } {
  const ambiente: Record<string, string> = {};
  for (const [i, bruta] of texto.split(/\r?\n/).entries()) {
    const l = bruta.trim();
    if (l === "" || l.startsWith("#")) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(l);
    if (m === null) return { ok: false, erro: `Ambiente, linha ${i + 1}: use NOME=valor` };
    ambiente[m[1]!] = m[2]!;
  }
  return { ok: true, ambiente };
}
export const escreverAmbiente = (a: Record<string, string>): string => Object.entries(a).map(([k, v]) => `${k}=${v}`).join("\n");

export const slugDe = (nome: string): string => {
  const base = nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36);
  return base === "" ? "exec" : base;
};

export interface ModeloConfig { rotulo: string; executavel: string; argumentos: string[]; tipo: "rodar" | "build" | "teste"; porta: number | null }
/** Pontos de partida do assistente "Configurar" (quando nada foi detectado). */
export const MODELOS: readonly ModeloConfig[] = [
  { rotulo: "Node: npm run dev", executavel: "npm", argumentos: ["run", "dev"], tipo: "rodar", porta: 3000 },
  { rotulo: "Node: npm start", executavel: "npm", argumentos: ["start"], tipo: "rodar", porta: 3000 },
  { rotulo: "Python: python3 main.py", executavel: "python3", argumentos: ["main.py"], tipo: "rodar", porta: null },
  { rotulo: "Python: Django runserver", executavel: "python3", argumentos: ["manage.py", "runserver"], tipo: "rodar", porta: 8000 },
  { rotulo: "Go: go run .", executavel: "go", argumentos: ["run", "."], tipo: "rodar", porta: null },
  { rotulo: "Rust: cargo run", executavel: "cargo", argumentos: ["run"], tipo: "rodar", porta: null },
  { rotulo: "Make: make run", executavel: "make", argumentos: ["run"], tipo: "rodar", porta: null },
  { rotulo: "Docker Compose: up", executavel: "docker", argumentos: ["compose", "up"], tipo: "rodar", porta: null },
  { rotulo: ".NET: dotnet run", executavel: "dotnet", argumentos: ["run"], tipo: "rodar", porta: 5000 },
  { rotulo: "Build: make build", executavel: "make", argumentos: ["build"], tipo: "build", porta: null },
  { rotulo: "Testes: npm test", executavel: "npm", argumentos: ["test"], tipo: "teste", porta: null },
];
