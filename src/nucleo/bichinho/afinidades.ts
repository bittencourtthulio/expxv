// Afinidades espécie × sinal (D-672). Cada sinal do projeto (linguagem, tipo, framework) tem uma lista ORDENADA de espécies: a primeira é a preferida
// (para as 14 originais, a mesma de sempre), as seguintes pontuam menos por degraus (`DEGRAUS`). Assim, quando a preferida já está em uso por outro
// workspace, a atribuição cai na próxima mais afim ainda livre. Dados puros, sem código de sorteio: o desempate é por hash estável em `especie.ts`.
import type { EspecieId } from "../../compartilhado/bichinho";
import type { LinguagemId, TipoProjeto } from "./sinais";

/** Fração dos pontos do sinal que cada posição da lista recebe (a 1ª recebe tudo; o resto cai de forma estável). */
export const DEGRAUS: readonly number[] = [1, 0.7, 0.55, 0.42, 0.3, 0.2, 0.12, 0.08, 0.05];

type Lista = readonly EspecieId[];

export const AFINIDADE_LINGUAGEM: Readonly<Record<LinguagemId, Lista>> = {
  rust: ["caranguejo", "tatu", "texugo", "escaravelho", "tartaruga", "rinoceronte", "lagosta"],
  python: ["piton", "corvo", "pato", "macaco", "lagarto", "tamandua", "lhama"],
  go: ["esquilo", "guepardo", "javali", "falcao", "coelho", "castor", "lula"],
  javascript: ["raposa", "arara", "macaco", "foca", "lemure", "guaxinim", "gaivota", "grilo"],
  typescript: ["camaleao", "iguana", "zebra", "pavao", "lince", "louva-a-deus", "cisne"],
  java: ["lontra", "cavalo", "formiga", "camelo", "hipopotamo", "alce", "golfinho"],
  kotlin: ["lontra", "coala", "canguru", "golfinho", "ornitorrinco", "quokka", "nautilo"],
  csharp: ["tucano", "leao", "ornitorrinco", "anta", "bisao", "pantera"],
  php: ["elefante", "hipopotamo", "bisao", "anta", "ovelha", "rinoceronte", "baiacu"],
  ruby: ["ourico", "escaravelho", "joaninha", "porco-espinho", "borboleta", "vaga-lume"],
  c: ["urso", "rinoceronte", "tatu", "javali", "escorpiao", "lobo", "tubarao"],
  cpp: ["urso", "tigre", "gorila", "rinoceronte", "lobo", "leao"],
  swift: ["sapo", "beija-flor", "cisne", "perereca", "falcao"],
  dart: ["sapo", "perereca", "beija-flor", "borboleta", "osga", "axolote"],
  shell: ["pinguim", "guaxinim", "coelho", "macaco", "lagarto", "avestruz", "morcego"],
  hcl: ["polvo", "baleia", "cavalo-marinho", "komodo", "estrela-do-mar"],
  markdown: ["gato", "cisne", "corvo", "vombate", "panda"],
};

export const AFINIDADE_TIPO: Readonly<Record<TipoProjeto, Lista>> = {
  dados: ["coruja", "lhama", "hipopotamo", "peixe-lua", "golfinho", "pelicano", "tamandua", "girafa"],
  infra: ["polvo", "baleia", "cavalo-marinho", "komodo", "gorila", "gaivota", "agua-viva", "suricato", "salamandra"],
  docs: ["gato", "cisne", "corvo", "vombate", "preguica", "panda"],
  mobile: ["sapo", "perereca", "beija-flor", "coala", "canguru", "osga", "lemure"],
  web: ["arara", "pavao", "foca", "borboleta", "cervo", "iguana", "aranha", "girafa"],
  api: ["jacare", "arraia", "cavalo", "lobo", "onca", "abelha", "bisao", "baiacu"],
  cli: ["pinguim", "macaco", "guaxinim", "coelho", "lagarto", "avestruz", "formiga"],
  biblioteca: ["panda", "castor", "quokka", "beija-flor", "libelula", "escaravelho", "vaga-lume", "capivara"],
};

/** Frameworks reconhecidos por `detectarSinais` (rótulo exato) e as espécies que eles puxam. Valem metade dos pontos de uma linguagem. */
export const AFINIDADE_FRAMEWORK: Readonly<Record<string, Lista>> = {
  React: ["arara", "foca", "pavao"],
  "Next.js": ["cavalo", "gaivota", "arara"],
  Vue: ["cervo", "lemure", "perereca"],
  Svelte: ["quokka", "libelula", "coelho"],
  Angular: ["iguana", "zebra", "alce"],
  Vite: ["guepardo", "beija-flor", "falcao"],
  Express: ["cavalo", "coelho", "lobo"],
  Fastify: ["guepardo", "falcao", "libelula"],
  NestJS: ["leao", "onca", "alce"],
  Electron: ["tartaruga", "caracol", "coala"],
  "React Native": ["perereca", "beija-flor", "flamingo"],
  Expo: ["beija-flor", "osga", "perereca"],
  Django: ["jacare", "pato", "anta"],
  Flask: ["pato", "vaga-lume", "formiga"],
  FastAPI: ["arraia", "guepardo", "falcao"],
  pandas: ["panda", "coruja", "tamandua"],
  NumPy: ["coruja", "formiga", "peixe-lua"],
  PyTorch: ["lhama", "tigre", "coruja"],
  TensorFlow: ["lhama", "lince", "coruja"],
  "scikit-learn": ["lince", "coruja", "lhama"],
  Jupyter: ["corvo", "coruja", "pato"],
  Spring: ["formiga", "camelo", "cavalo"],
  Android: ["coala", "canguru", "osga"],
  Laravel: ["elefante", "ovelha", "bisao"],
  Symfony: ["anta", "bisao", "rinoceronte"],
  Flutter: ["beija-flor", "perereca", "borboleta"],
};

/** Peso relativo de um framework frente a uma linguagem dominante (que vale 10). */
export const PONTOS_FRAMEWORK = 5;
