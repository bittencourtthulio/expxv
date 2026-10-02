// Catálogo de espécies do Bichinho (D-461, D-670…): 100 espécies, cada uma com grupo, o que representa e uma personalidade curta.
// A cor NÃO mora aqui: a paleta da espécie vem da receita (renderer/bichinho/sprites) ou, nas 14 legadas, do token `--bichinho-<id>` em tokens.css.
// Metadados só em texto (leve): a arte é um sistema de partes no renderer. Afinidades com stack/tipo: `afinidades.ts`.
import { ESPECIES, GRUPOS_ESPECIE, type EspecieId, type GrupoEspecie } from "../../compartilhado/bichinho";

export interface DefEspecie {
  id: EspecieId;
  rotulo: string;
  grupo: GrupoEspecie;
  /** o que a espécie representa no catálogo (aparece em 04-UI-UX e no popover). */
  representa: string;
  personalidade: string;
}

export const ROTULO_GRUPO: Readonly<Record<GrupoEspecie, string>> = {
  mamiferos: "Mamíferos", aves: "Aves", repteis: "Répteis", anfibios: "Anfíbios", aquaticos: "Peixes e cetáceos", invertebrados: "Invertebrados", insetos: "Insetos e aracnídeos",
};

type Linha = readonly [id: EspecieId, rotulo: string, grupo: GrupoEspecie, representa: string, personalidade: string];

const M = "mamiferos", A = "aves", R = "repteis", N = "anfibios", Q = "aquaticos", I = "invertebrados", S = "insetos";

const LINHAS: readonly Linha[] = [
  ["caranguejo", "Caranguejo", I, "Rust", "Blindado e metódico: não deixa nada vazar, anda de lado até achar o caminho seguro."],
  ["piton", "Piton", R, "Python", "Calma e legível: enrola o problema até ele caber numa linha."],
  ["esquilo", "Esquilo", M, "Go", "Rápido e enxuto: junta só o que precisa e corre em paralelo."],
  ["raposa", "Raposa", M, "JavaScript", "Esperta e improvisada: acha atalho em qualquer ambiente."],
  ["camaleao", "Camaleão", R, "TypeScript", "Atento aos tipos: muda de cor para combinar com cada contrato."],
  ["lontra", "Lontra", M, "Java e Kotlin", "Sociável e persistente: boia na JVM com tudo organizado em pacotes."],
  ["tucano", "Tucano", A, "C# e .NET", "Vistoso e confiável: bico grande para carregar solução inteira."],
  ["elefante", "Elefante", M, "PHP", "Memória longa e veterano da web: nunca esquece uma requisição."],
  ["ourico", "Ouriço", M, "Ruby", "Elegante por fora, cheio de espinhos de convenção por dentro."],
  ["coruja", "Coruja", A, "dados, ML e análise", "Noturna e analítica: enxerga padrão no escuro dos dados."],
  ["polvo", "Polvo", I, "infraestrutura e DevOps", "Oito braços: segura pipeline, contêiner e cluster ao mesmo tempo."],
  ["gato", "Gato", M, "documentação", "Observador e independente: deita em cima do texto e o mantém em ordem."],
  ["sapo", "Sapo", N, "mobile (Swift, Dart, Android)", "Salta de tela em tela: leve, ágil e sempre na palma da mão."],
  ["urso", "Urso", M, "C e C++", "Forte e direto: levanta peso perto do metal, sem pedir licença."],
  // ---- mamíferos
  ["capivara", "Capivara", M, "monorepos tranquilos", "Zen e sociável: todo mundo encosta nela e o build continua calmo."],
  ["lobo", "Lobo", M, "servidores e trabalho em equipe", "Líder de matilha: coordena processos e não deixa nenhum worker para trás."],
  ["tigre", "Tigre", M, "desempenho e C++ de alto nível", "Silencioso e preciso: ataca o gargalo de uma vez só."],
  ["leao", "Leão", M, "arquitetura e liderança técnica", "Majestoso: decide a arquitetura e a defende com rugido calmo."],
  ["pantera", "Pantera", M, "segurança", "Discreta e atenta: vigia o perímetro do código no escuro."],
  ["lince", "Lince", M, "revisão de código e busca", "Olhar afiado: acha o bug escondido a cem linhas de distância."],
  ["guepardo", "Guepardo", M, "velocidade e otimização", "Acelera do zero ao pico num instante, mas poupa fôlego."],
  ["onca", "Onça", M, "back-end robusto", "Força silenciosa da mata: segura o back-end sem pedir ajuda."],
  ["panda", "Panda", M, "bibliotecas e análise tabular", "Mastiga dependência com calma e nunca perde a ternura."],
  ["coala", "Coala", M, "Android e Kotlin", "Abraça o galho do app e só acorda para o deploy."],
  ["canguru", "Canguru", M, "migrações e deploy", "Carrega tudo na bolsa e salta de versão em versão."],
  ["preguica", "Preguiça", M, "jobs em lote e processos lentos", "Devagar e sempre: um job por vez, sem estourar a memória."],
  ["tamandua", "Tamanduá", M, "parsers e coleta de dados", "Língua comprida: puxa dado de qualquer formigueiro."],
  ["tatu", "Tatu", M, "defesa em profundidade", "Armadura de testes: enrola e nada o atinge."],
  ["anta", "Anta", M, "sistemas legados resistentes", "Antiga, resistente e subestimada: atravessa o rio de código velho."],
  ["suricato", "Suricato", M, "monitoramento e observabilidade", "Sentinela: de pé no morro, avisa quando algo se move."],
  ["lemure", "Lêmure", M, "animação e interfaces vivas", "Cauda listrada e agilidade: pula de componente em componente."],
  ["macaco", "Macaco", M, "scripts e automação", "Curioso e ágil: pendura um script no outro até a tarefa fechar."],
  ["gorila", "Gorila", M, "infraestrutura pesada", "Força tranquila: levanta o cluster inteiro sem suar."],
  ["cervo", "Cervo", M, "interfaces elegantes", "Gracioso e atento: cuida dos detalhes da tela."],
  ["alce", "Alce", M, "plataformas grandes", "Galhada ampla: abriga vários serviços sob o mesmo teto."],
  ["camelo", "Camelo", M, "resistência e longas jornadas", "Atravessa o deserto de um refactor sem pedir água."],
  ["lhama", "Lhama", M, "IA e modelos de linguagem", "Pelo macio e cabeça fria: conversa com qualquer modelo."],
  ["cavalo", "Cavalo", M, "APIs e servidores de carga", "Cavalo de trabalho: puxa requisição o dia inteiro."],
  ["zebra", "Zebra", M, "testes e tipagem", "Listras de passa e falha: tudo é preto no branco."],
  ["girafa", "Girafa", M, "visão ampla e painéis", "Pescoço comprido: enxerga a arquitetura de cima."],
  ["rinoceronte", "Rinoceronte", M, "sistemas de baixo nível", "Blindado e teimoso: atravessa a parede de segfaults."],
  ["hipopotamo", "Hipopótamo", M, "bancos de dados e SQL", "Boca enorme: engole tabela grande sem engasgar."],
  ["javali", "Javali", M, "desempenho bruto", "Cabeça dura: abre caminho no código lento."],
  ["porco-espinho", "Porco-espinho", M, "validação de entrada", "Espinhos de validação: entrada ruim não passa."],
  ["castor", "Castor", M, "build e CI", "Construtor incansável: corta, empilha e entrega o pacote."],
  ["ornitorrinco", "Ornitorrinco", M, "integração e projetos poliglotas", "Mistura de tudo: bico, cauda e pelo, e funciona."],
  ["vombate", "Vombate", M, "refatoração e migração de dados", "Cavador: escava o legado e deixa a toca em ordem."],
  ["quokka", "Quokka", M, "protótipos e projetos pessoais", "Sorriso de quem acabou de rodar o primeiro teste verde."],
  ["morcego", "Morcego", M, "tarefas agendadas e noturnas", "Acorda quando o cron toca e dorme de cabeça para baixo."],
  ["coelho", "Coelho", M, "scripts rápidos e protótipos", "Salta de ideia em ideia e entrega antes do café esfriar."],
  ["ovelha", "Ovelha", M, "réplicas e contêineres", "Rebanho de réplicas: uma cai, outra assume."],
  ["guaxinim", "Guaxinim", M, "limpeza e scripts de shell", "Fuça no lixo do repositório e devolve tudo limpinho."],
  ["texugo", "Texugo", M, "resiliência e testes teimosos", "Teimoso: não solta o bug até ele virar teste."],
  ["bisao", "Bisão", M, "monolitos de grande porte", "Corpanzil de monolito: lento para virar, impossível de parar."],
  ["foca", "Foca", M, "front-end e interfaces", "Equilibra a bola da interface no nariz e aplaude."],
  // ---- aves
  ["arara", "Arara", A, "front-end colorido", "Colorida e falante: dá cor e voz à interface."],
  ["pinguim", "Pinguim", A, "Linux e linha de comando", "Elegante no gelo do terminal: desliza pelo shell."],
  ["falcao", "Falcão", A, "desempenho e vigilância", "Mergulha do alto sobre a métrica que importa."],
  ["corvo", "Corvo", A, "pesquisa e mensageria", "Esperto: junta pistas e leva a mensagem certa."],
  ["pavao", "Pavão", A, "design e vitrines", "Abre o leque: faz da tela uma vitrine."],
  ["flamingo", "Flamingo", A, "equilíbrio e cross-platform", "Numa pata só: equilibra plataformas sem cair."],
  ["pato", "Pato", A, "tipagem dinâmica e dados analíticos", "Se anda como pato e grasna como pato, o teste passa."],
  ["cisne", "Cisne", A, "design e documentação limpa", "Desliza sereno: nada de ruído na superfície."],
  ["pelicano", "Pelicano", A, "armazenamento e backup", "Bolsa grande: guarda dado para o dia de escassez."],
  ["beija-flor", "Beija-flor", A, "bibliotecas leves e mobile", "Minúsculo e veloz: paira sobre a menor dependência."],
  ["avestruz", "Avestruz", A, "ferramentas de linha de comando", "Corre mais que o resto e enfia a cabeça só no log."],
  ["gaivota", "Gaivota", A, "nuvem e CDN", "Plana sobre a nuvem e pousa onde a borda estiver."],
  // ---- répteis
  ["tartaruga", "Tartaruga", R, "suporte longo e estabilidade", "Devagar, segura e com casa própria: vai longe."],
  ["jacare", "Jacaré", R, "APIs e ORMs", "Boca aberta no pântano de requisições: nada escapa."],
  ["lagarto", "Lagarto", R, "scripts leves", "Toma sol no terminal e some por uma fresta."],
  ["iguana", "Iguana", R, "front-end estruturado", "Crista alinhada: tudo no seu componente."],
  ["komodo", "Dragão-de-komodo", R, "servidores de grande porte", "Pesado e paciente: espera o servidor render."],
  ["osga", "Osga", R, "microsserviços e apps pequenos", "Gruda em qualquer parede e cabe em qualquer frestinha."],
  // ---- anfíbios
  ["axolote", "Axolote", N, "regeneração e hot reload", "Sorridente: perde um serviço e já nasce outro."],
  ["salamandra", "Salamandra", N, "tolerância a falhas", "Atravessa o fogo do incidente sem perder a cor."],
  ["perereca", "Perereca", N, "mobile multiplataforma", "Gruda em qualquer tela e salta entre sistemas."],
  // ---- peixes e cetáceos
  ["baleia", "Baleia", Q, "contêineres e Docker", "Carrega contêiner nas costas e canta no cluster."],
  ["golfinho", "Golfinho", Q, "SQL e inteligência", "Brincalhão e esperto: salta por cima da query lenta."],
  ["tubarao", "Tubarão", Q, "segurança e auditoria", "Fareja vulnerabilidade a quilômetros."],
  ["arraia", "Arraia", Q, "APIs fluidas e streaming", "Plana pelo fluxo de dados sem fazer onda."],
  ["baiacu", "Baiacu", Q, "defesa e validação", "Infla quando entra dado estranho."],
  ["cavalo-marinho", "Cavalo-marinho", Q, "orquestração de serviços", "Cauda enrolada em cada serviço do cluster."],
  ["peixe-lua", "Peixe-lua", Q, "grandes volumes de dados", "Redondão e tranquilo: engole um oceano de logs."],
  // ---- invertebrados
  ["agua-viva", "Água-viva", I, "serverless e nuvem", "Flutua sem servidor e brilha quando escala."],
  ["estrela-do-mar", "Estrela-do-mar", I, "sistemas distribuídos", "Perde um braço e segue funcionando."],
  ["lula", "Lula", I, "mensageria e filas", "Jato de mensagens: dispara e some na tinta."],
  ["lagosta", "Lagosta", I, "back-end blindado", "Carapaça dura, pinça firme: contrato é contrato."],
  ["nautilo", "Nautilo", I, "recursão e programação funcional", "Concha em espiral: cada câmara chama a anterior."],
  ["caracol", "Caracol", I, "self-hosted e apps empacotados", "Leva a casa nas costas: roda em qualquer lugar."],
  // ---- insetos e aracnídeos
  ["abelha", "Abelha", S, "workers e colaboração", "Colmeia organizada: cada worker no seu favo."],
  ["joaninha", "Joaninha", S, "caça a bugs e QA", "Pintinhas de teste: devora bug pequeno antes de crescer."],
  ["borboleta", "Borboleta", S, "transformações e refatorações", "Casulo de refactor: sai outra, mais leve."],
  ["louva-a-deus", "Louva-a-deus", S, "revisão de código", "Imóvel e atento: só se mexe para apontar o erro."],
  ["escaravelho", "Escaravelho", S, "pacotes e bibliotecas", "Rola a dependência até o lugar certo."],
  ["formiga", "Formiga", S, "microsserviços e builds", "Trilha de feromônio: pequena, mas faz milhões em paralelo."],
  ["libelula", "Libélula", S, "serviços leves e ágeis", "Asas transparentes: paira sobre a latência."],
  ["grilo", "Grilo", S, "linters e consciência de qualidade", "Canta baixinho cada aviso de lint."],
  ["vaga-lume", "Vaga-lume", S, "logs e observabilidade", "Acende uma luz no breu do log."],
  ["aranha", "Aranha", S, "web e coleta de páginas", "Tece a teia de links e sente cada vibração."],
  ["escorpiao", "Escorpião", S, "segurança ofensiva responsável", "Cauda armada: só ferroa o que merece."],
];

export const CATALOGO: Readonly<Record<EspecieId, DefEspecie>> = Object.fromEntries(
  LINHAS.map(([id, rotulo, grupo, representa, personalidade]) => [id, { id, rotulo, grupo, representa, personalidade }]),
) as Record<EspecieId, DefEspecie>;

/** Espécies de um grupo, na ordem do catálogo. */
export const especiesDoGrupo = (g: GrupoEspecie): EspecieId[] => ESPECIES.filter((e) => CATALOGO[e].grupo === g);
export const TODOS_OS_GRUPOS = GRUPOS_ESPECIE;
