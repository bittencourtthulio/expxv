import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { leitorDeDisco } from "./armazem";
import { corpoDaConfig, detectarConfiguracoes, type LeitorProjeto } from "./detectar";
import { validarConfig } from "./validacao";

const FIXTURES = resolve(__dirname, "../../../tests/fixtures/executar");
const detectar = (nome: string) => detectarConfiguracoes(leitorDeDisco(join(FIXTURES, nome)));
const linha = (c: { executavel: string; argumentos: string[] }) => [c.executavel, ...c.argumentos].join(" ");

/** projeto de exemplo → [ecossistema, [id, linha de comando] esperados, padrão sugerido] */
const TABELA: Array<[string, string, Array<[string, string]>, string | null]> = [
  ["node-vite", "node", [["dev", "pnpm run dev"], ["build", "pnpm run build"], ["preview", "pnpm run preview"], ["test", "pnpm run test"]], "dev"],
  ["node-next", "node", [["dev", "yarn run dev"], ["build", "yarn run build"], ["start", "yarn run start"], ["build-e-rodar", "yarn run start"]], "dev"],
  ["node-cra", "node", [["start", "npm run start"], ["build", "npm run build"], ["test", "npm run test"]], "start"],
  ["node-electron", "node", [["electron-dev", "bun run electron:dev"], ["build", "bun run build"]], "electron-dev"],
  ["make", "make", [["run", "make run"], ["build", "make build"], ["test", "make test"]], "run"],
  ["just", "just", [["dev", "just dev"], ["build", "just build"]], "dev"],
  ["cargo", "cargo", [["rodar-cargo", "cargo run"], ["build-cargo", "cargo build --release"], ["test-cargo", "cargo test"], ["build-e-rodar-cargo", "cargo run"]], "rodar-cargo"],
  ["go", "go", [["rodar-go", "go run ."], ["build-go", "go build ./..."], ["test-go", "go test ./..."]], "rodar-go"],
  ["go-cmd", "go", [["rodar-go", "go run ./cmd/api"]], "rodar-go"],
  ["python-django", "python", [["runserver", "python3 manage.py runserver"], ["test-django", "python3 manage.py test"], ["pytest", "python3 -m pytest"]], "runserver"],
  ["python-fastapi", "python", [["uvicorn", "python3 -m uvicorn main:app --reload"]], "uvicorn"],
  ["python-flask", "python", [["flask", "python3 -m flask --app app run --debug"]], "flask"],
  ["python-modulo", "python", [["python-m", "python3 -m meuapp"]], null],
  ["compose", "docker", [["compose-up", "docker compose up"], ["compose-down", "docker compose down"]], "compose-up"],
  ["maven-spring", "maven", [["spring-boot-run", "./mvnw spring-boot:run"], ["build-maven", "./mvnw package"]], "spring-boot-run"],
  ["gradle-spring", "gradle", [["boot-run", "./gradlew bootRun"], ["build-gradle", "./gradlew build"]], "boot-run"],
  ["dotnet-web", "dotnet", [["dotnet-run", "dotnet run --project app.csproj"], ["build-dotnet", "dotnet build"], ["test-dotnet", "dotnet test"]], "dotnet-run"],
  ["flutter", "flutter", [["flutter-run", "flutter run"], ["test-flutter", "flutter test"]], "flutter-run"],
  ["deno", "deno", [["dev", "deno task dev"], ["test", "deno task test"]], "dev"],
  ["php-laravel", "php", [["artisan-serve", "php artisan serve"]], "artisan-serve"],
  ["ruby-rails", "ruby", [["rails-server", "./bin/rails server"]], "rails-server"],
  ["estatico", "estatico", [["servir-pasta", "python3 -m http.server 8080 --bind 127.0.0.1"]], "servir-pasta"],
];

describe("detecção de configurações de execução (≥ 12 tipos de projeto)", () => {
  it.each(TABELA)("%s", (nome, eco, esperados, padrao) => {
    const r = detectar(nome);
    expect(r.ecossistemas).toContain(eco);
    for (const [id, cmd] of esperados) {
      const c = r.configuracoes.find((x) => x.id === id);
      expect(c, `${nome}: id ${id}`).toBeDefined();
      expect(linha(c!)).toBe(cmd);
    }
    if (padrao !== null) expect(r.padrao_sugerido).toBe(padrao);
  });

  it("projeto sem nada reconhecível não tem configuração (a UI abre o assistente)", () => {
    const r = detectar("vazio");
    expect(r.configuracoes).toEqual([]);
    expect(r.padrao_sugerido).toBeNull();
  });

  it("toda configuração detectada passa pela validação estrita, é de origem detectada e tem id único", () => {
    for (const [nome] of TABELA) {
      const r = detectar(nome);
      const ids = new Set<string>();
      for (const c of r.configuracoes) {
        expect(ids.has(c.id), `${nome}: id repetido ${c.id}`).toBe(false);
        ids.add(c.id);
        expect(c.origem).toBe("detectada");
        const v = validarConfig(c, "detectada");
        expect(v.ok, `${nome}/${c.id}: ${v.ok ? "" : v.erro}`).toBe(true);
      }
    }
  });

  it("'Build e rodar' vira sequência de pré-passos (build) + comando principal", () => {
    const c = detectar("node-next").configuracoes.find((x) => x.id === "build-e-rodar")!;
    expect(c.pre_passos).toEqual([{ executavel: "yarn", argumentos: ["run", "build"] }]);
    expect(c.nome).toBe("Build e rodar");
    expect(detectar("cargo").configuracoes.find((x) => x.id === "build-e-rodar-cargo")!.pre_passos).toEqual([{ executavel: "cargo", argumentos: ["build"] }]);
  });

  it("dica de porta e abertura no navegador só para servidor web conhecido (nunca para Electron)", () => {
    const vite = detectar("node-vite").configuracoes;
    expect(vite.find((c) => c.id === "dev")).toMatchObject({ porta: 5173, abrir_navegador: true });
    expect(vite.find((c) => c.id === "preview")).toMatchObject({ porta: 4173 });
    expect(vite.find((c) => c.id === "build")).toMatchObject({ porta: null, abrir_navegador: false, tipo: "build" });
    expect(detectar("node-next").configuracoes.find((c) => c.id === "dev")).toMatchObject({ porta: 3000 });
    expect(detectar("node-electron").configuracoes.find((c) => c.id === "electron-dev")).toMatchObject({ porta: null, abrir_navegador: false });
  });

  it("injeção por nome de script: nomes com '-', espaço, ';' ou fora da lista nunca viram configuração", () => {
    const r = detectar("node-malicioso");
    expect(r.configuracoes.map((c) => c.id)).toEqual(["dev"]);
    for (const c of r.configuracoes) for (const a of c.argumentos) expect(a.startsWith("-")).toBe(false);
  });

  it("o corpo do script do repositório acompanha a detecção (vai ao hash e ao diálogo)", () => {
    const r = detectar("node-vite");
    expect(r.corpos["dev"]).toBe("vite");
    expect(r.corpos["build-e-rodar"]).toBeUndefined();
  });

  it("um detector com erro não derruba os demais", () => {
    const quebrado: LeitorProjeto = {
      ler: (rel) => { if (rel === "package.json") throw new Error("boom"); return rel === "Cargo.toml" ? "[package]" : null; },
      existe: (rel) => rel === "Cargo.toml",
      listar: () => [],
    };
    expect(detectarConfiguracoes(quebrado).configuracoes.map((c) => c.id)).toContain("rodar-cargo");
  });
});

describe("corpoDaConfig", () => {
  const l = (arquivos: Record<string, string>): LeitorProjeto => ({ ler: (r) => arquivos[r] ?? null, existe: (r) => r in arquivos, listar: () => [] });
  it("script do package.json (com pre/post), receita do Makefile e conteúdo de script relativo", () => {
    const pk = JSON.stringify({ scripts: { dev: "vite", predev: "echo oi", build: "tsc" } });
    expect(corpoDaConfig(l({ "package.json": pk }), { executavel: "npm", argumentos: ["run", "dev"], pre_passos: [], shell: null })).toBe("dev: vite\npredev: echo oi");
    expect(corpoDaConfig(l({ "package.json": pk }), { executavel: "npm", argumentos: ["start"], pre_passos: [{ executavel: "npm", argumentos: ["run", "build"] }], shell: null })).toBe("build: tsc");
    expect(corpoDaConfig(l({ Makefile: "run:\n\tpython3 app.py\n" }), { executavel: "make", argumentos: ["run"], pre_passos: [], shell: null })).toContain("python3 app.py");
    expect(corpoDaConfig(l({ "scripts/run.sh": "#!/bin/sh\nrm -rf x\n" }), { executavel: "./scripts/run.sh", argumentos: [], pre_passos: [], shell: null })).toContain("rm -rf x");
    expect(corpoDaConfig(l({}), { executavel: "cargo", argumentos: ["run"], pre_passos: [], shell: null })).toBeNull();
  });
});
