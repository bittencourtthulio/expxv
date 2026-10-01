# G. Provedores de banco vetorial para o RAG online do ExpxV

Consulta: 2026-09-30. Pesquisa somente leitura (documentação pública, sem cadastro, sem chave, sem envio de dados).

Legenda de confiança: **[doc]** = lido na página oficial de documentação nesta consulta; **[busca]** = resultado de busca que cita a documentação oficial ou página de preço, não lido na íntegra; **não confirmado** = não consegui verificar. Preços e limites mudam: reconferir na hora de implementar.

Fontes principais (todas consultadas em 2026-09-30):
- Qdrant: https://qdrant.tech/documentation/cloud/authentication/ , https://qdrant.tech/documentation/concepts/points/ , https://qdrant.tech/pricing/ (busca)
- Pinecone: https://docs.pinecone.io/reference/api/database-limits , https://docs.pinecone.io/guides/index-data/upsert-data
- Weaviate: https://docs.weaviate.io/weaviate/concepts/data , https://weaviate.io/pricing , https://docs.weaviate.io/deploy/configuration/authentication (busca)
- Chroma: https://docs.trychroma.com/docs/overview/introduction , https://docs.trychroma.com/cloud/pricing
- Milvus/Zilliz: https://milvus.io/api-reference/restful/v2.5.x/About.md , https://docs.zilliz.com/docs/free-trials (busca)
- pgvector: https://github.com/pgvector/pgvector ; Supabase: https://supabase.com/docs/guides/api , https://supabase.com/pricing ; Neon: https://neon.com/docs/extensions/pgvector , https://neon.com/pricing
- Turso: https://docs.turso.tech/features/ai-and-embeddings , https://turso.tech/pricing , https://docs.turso.tech/sdk/http/reference (busca)
- Upstash: https://upstash.com/docs/vector/overall/getstarted , https://upstash.com/docs/vector/overall/pricing
- MongoDB: https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-type/ ; fim da Data API: https://www.mongodb.com/community/forums/t/mongodb-atlas-data-api-and-custom-https-endpoints-end-of-life-and-deprecation/296686 (busca)
- Elasticsearch: https://www.elastic.co/docs/solutions/search/vector/knn ; dense_vector: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/dense-vector (busca) ; OpenSearch: https://docs.opensearch.org/docs/latest/vector-search/
- Redis: https://redis.io/docs/latest/develop/ai/search-and-query/vectors/
- LanceDB: https://lancedb.github.io/lancedb/ (pouco detalhe obtido)

---

## 1. Fichas por provedor

### 1.1 Qdrant (Cloud e self-host)
1. **Auth**: API key no header `api-key: <chave>` ou `Authorization: Bearer <chave>`, em REST e gRPC [doc]. Chaves novas (v1.11+) têm controle granular por coleção [doc]. UI: URL do cluster (com porta 6333 no self-host), chave, nome da coleção. Região é implícita na URL.
2. **API**: REST `PUT /collections/{c}/points` (upsert), `POST .../points/scroll` (paginação por cursor), `POST .../points/delete` (por ids ou filtro), `POST .../points/count`, `POST .../points/query` (busca) [doc de pontos; paths exatos de memória, conferir no OpenAPI]. Filtro por payload (must/should/must_not, match, range) é nativo: filtra por projeto/equipe/tipo. Híbrido: sim (vetores esparsos + densos com fusão/RRF na Query API) [não lido nesta consulta; conferir]. IDs: UUID ou inteiro sem sinal [doc]. Limites de batch/payload: não confirmado (a página não trouxe números).
3. **Node**: cliente oficial `@qdrant/js-client-rest` (TypeScript), mas REST puro com `fetch` é trivial. Tamanho do cliente: não confirmado.
4. **Multi-tenancy**: recomendado uma coleção única com campo de payload `projeto_id` indexado (filtro) ou coleção por projeto; chaves granulares por coleção permitem separar equipes.
5. **Migração/retomada**: upsert idempotente por id (UUID derivado do hash); `scroll` com `offset` para exportar de volta.
6. **Preço**: Cloud gratuito permanente de 1 GB RAM/0,5 vCPU/4 GB disco, sem cartão, suspende após 1 semana sem uso e apaga após 4 semanas [busca: qdrant.tech/pricing]; pago por recursos do cluster. Self-host: Docker `qdrant/qdrant` (Apache 2.0).
7. **Riscos**: free tier apaga cluster inativo (risco de perda de "cérebro" se for o único lugar). Baixo lock-in (open source).

### 1.2 Pinecone
1. **Auth**: API key no header `Api-Key` (+ `X-Pinecone-API-Version`) [header de memória; não lido]. UI: chave, nome do índice (o host do índice é obtido via `describe_index` ou informado), namespace. Região escolhida na criação do índice; Starter é só AWS us-east-1 [busca].
2. **API**: upsert (até 1.000 registros ou 2 MB por lote para vetores; 96 para texto com embedding integrado) [doc]; sobrescreve o registro inteiro se o id existir [doc]. Fetch, delete, `list` ids paginado, `describe_index_stats` (contagem por namespace) [uso conhecido; não lido]. Filtro por metadado: sim. Híbrido: sim, com vetores esparsos e documentos BM25 [doc]. Limites de dimensão e metadados por registro: não confirmado (página de limites só listou categorias).
3. **Node**: SDK oficial `@pinecone-database/pinecone`; REST via `fetch` é viável (host por índice). Tamanho: não confirmado.
4. **Multi-tenancy**: namespaces (recomendados para multitenancy [doc]); Starter: 100 namespaces por índice [busca]. Um namespace por projeto.
5. **Migração**: upsert idempotente por id; export via `list` + `fetch` (mais lento que scroll; atenção a consistência eventual).
6. **Preço**: Starter grátis: 2 GB, 2M unidades de escrita e 1M de leitura por mês, 5 índices, pausa após 3 semanas de inatividade [busca]. Pago por uso (unidades de leitura/escrita). Sem self-host (só nuvem; para teste local existe emulador, não confirmado).
7. **Riscos**: lock-in (sem self-host), custo por operação, Starter limitado a uma região (residência de dados: EUA).

### 1.3 Weaviate (Cloud e self-host)
1. **Auth**: `Authorization: Bearer <API key>` (também OIDC) [busca: docs.weaviate.io/deploy/configuration/authentication]. UI: URL (REST) e possivelmente host gRPC, chave, nome da coleção, tenant.
2. **API**: REST `/v1` (batch de objetos em `POST /v1/batch/objects`, GraphQL para busca) [busca]; o cliente TS v3 usa gRPC (não confirmado se REST+GraphQL cobre tudo com facilidade). Objetos têm UUID [doc]. Filtro por propriedade: sim. Híbrido (BM25 + vetor): sim, nativo [doc de preço]. Limites: não confirmado.
3. **Node**: `weaviate-client` oficial (TS; usa gRPC, mais pesado). REST+GraphQL puro é possível porém verboso. Tamanho: não confirmado.
4. **Multi-tenancy**: nativo, um shard por tenant [doc]; ou coleção por projeto. Excelente isolamento.
5. **Migração**: batch com UUID determinístico (idempotente); exportação por cursor (`after`) na listagem de objetos [de memória; conferir].
6. **Preço**: Cloud grátis (1 cluster, 100.000 objetos, 1 GB memória, 10 GB disco) [doc]; Flex a partir de US$ 45/mês pago por uso [doc]. Self-host em Docker (BSD).
7. **Riscos**: free tier pequeno (100 mil objetos); cliente TS depende de gRPC (atrito no Electron/proxy corporativo); esquema obrigatório.

### 1.4 Chroma (Cloud e self-host)
1. **Auth**: Cloud com header `x-chroma-token` [busca]; self-host aceita token/basic conforme configuração [busca]. UI: host, chave (token), tenant, database, coleção.
2. **API**: REST v2 hierárquica `/api/v2/tenants/{t}/databases/{d}/collections/{id}/...` com add, upsert, update, get (por ids ou filtro), delete, count, query [busca]. `get` aceita `limit` e `offset` (paginação) [busca]. Filtro por metadado: sim. Híbrido: sim (denso, esparso, texto completo, regex) [doc]. IDs: strings livres. Limites: não confirmado.
3. **Node**: `chromadb` oficial (TS). REST puro possível, mas a coleção é endereçada por UUID interno (precisa resolver nome para id). Tamanho: não confirmado.
4. **Multi-tenancy**: tenant, database e coleção [busca]; uma coleção ou database por projeto.
5. **Migração**: upsert por id; export via `get` com limit/offset.
6. **Preço**: Cloud por uso: escrita US$ 2,50/GiB, leitura US$ 0,0075/TiB consultado + US$ 0,09/GiB retornado, armazenamento US$ 0,33/GiB/mês; US$ 5 de crédito inicial, sem free tier permanente [doc]. Self-host: Apache 2.0, Docker/pip.
7. **Riscos**: API mudou entre versões (v1 para v2); ids internos de coleção; maturidade do Cloud menor.

### 1.5 Milvus / Zilliz Cloud
1. **Auth**: header `Authorization: Bearer <token>`, em que o token é `usuario:senha` no self-host (ex.: `root:Milvus`) ou a API key no Zilliz [doc]. Por padrão o Milvus self-host NÃO exige credenciais [doc]. UI: URI, token (ou usuário e senha), banco de dados, coleção.
2. **API**: RESTful v2 (`POST /v2/vectordb/...`), recomendada; v1 será descontinuada [doc]. Operações: insert/upsert, query (com `filter`, `limit`, `offset`), search, delete (por filtro), contagem via query/`count(*)` [de memória; conferir]. Filtro: expressão booleana sobre campos escalares. Híbrido: sim (busca híbrida multi-vetor com esparso/BM25) [de memória; conferir]. Esquema obrigatório.
3. **Node**: `@zilliz/milvus2-sdk-node` oficial (gRPC, pesado); REST v2 com `fetch` é suficiente.
4. **Multi-tenancy**: banco de dados, coleção ou partição por projeto; ou campo escalar `projeto_id` + filtro.
5. **Migração**: upsert por chave primária; export via `query` com offset/limit (paginação com limites de offset+limit: não confirmado) ou iterador do SDK.
6. **Preço**: Zilliz free: 5 GB, 2,5M vCUs/mês, até 5 coleções [busca]; créditos de US$ 100 por 30 dias para e-mail corporativo [busca]. Self-host Docker/Compose (Apache 2.0, Milvus Lite embarcado em Python).
7. **Riscos**: esquema rígido; paginação por offset com teto; Milvus completo é pesado de operar.

### 1.6 Postgres + pgvector (Supabase, Neon, Postgres gerenciado)
1. **Auth**: Supabase REST (PostgREST): headers `apikey` e `Authorization: Bearer`, chaves `anon` ou `service_role`, com RLS [doc]; endpoint `https://<ref>.supabase.co/rest/v1/` [doc]. Neon e Postgres genérico: string de conexão (host, porta, usuário, senha, banco, `sslmode=require`) via TCP. Neon tem driver HTTP/WebSocket (serverless) [não lido]. UI: Supabase = URL + chave; genérico = URL de conexão ou campos separados.
2. **API**: SQL puro: `INSERT ... ON CONFLICT (id) DO UPDATE` (upsert), `SELECT ... ORDER BY embedding <=> $1 LIMIT k` (consulta), `DELETE ... WHERE`, `count(*)`, paginação por keyset (`WHERE id > $cursor ORDER BY id LIMIT n`). Filtro por metadado: SQL completo (colunas `projeto_id`, `tipo`, JSONB). Híbrido: sim, combinando vetor com busca de texto completa do Postgres (`tsvector`), ex.: RRF em SQL [doc pgvector]. Limites pgvector: tipo `vector` até 16.000 dimensões, mas índices HNSW/IVFFlat só até 2.000 (`vector`) e 4.000 (`halfvec`) [doc]. Operadores: `<->` L2, `<#>` produto interno negativo, `<=>` cosseno [doc]. Filtro é aplicado após o índice aproximado; `iterative scan` a partir da 0.8.0 mitiga [doc].
3. **Node**: Supabase: `fetch` para PostgREST (precisa criar funções `rpc` para busca vetorial) ou `@supabase/supabase-js`. Genérico/Neon: biblioteca `pg` (TCP, nativa de Node, módulo relativamente leve) ou `@neondatabase/serverless`. REST puro só no Supabase (e exige migração SQL aplicada pelo usuário: tabela, função `rpc`, RLS).
4. **Multi-tenancy**: coluna `projeto_id` + RLS (Supabase) ou schema por projeto. Melhor modelo de compartilhamento por equipe (RLS por usuário/organização).
5. **Migração**: `INSERT ... ON CONFLICT DO UPDATE` em lotes dentro de transação; export por keyset. Retomada trivial. Exige DDL prévio (`CREATE EXTENSION vector`, tabela, índice).
6. **Preço**: Supabase Free: 500 MB de banco, até 2 projetos, pausa após 1 semana sem atividade; Pro US$ 25/mês com 8 GB [doc]. Neon Free: 0,5 GB, 100 CU-horas, escala a zero após 5 min; Launch por uso (US$ 0,35/GB-mês) [doc]. Self-host: imagem Docker `pgvector/pgvector`.
7. **Riscos**: usuário precisa rodar DDL (permissões); dimensão acima de 2.000 sem `halfvec` não indexa; chave `service_role` ignora RLS (nunca deve ir para clientes finais; num app desktop, preferir chave com RLS ou papel Postgres restrito); free tier pausa.

### 1.7 Turso / libSQL com vetores
1. **Auth**: `Authorization: Bearer <token do banco>` (token por banco, criado com `turso db tokens create`) [busca]. UI: URL do banco (`libsql://...`), token.
2. **API**: SQL sobre HTTP (`POST /v2/pipeline` com `execute`) [busca]. Vetores: tipos `F32_BLOB(n)` e outros, funções `vector_distance_cos/l2`, índice DiskANN via `libsql_vector_idx`, busca com `vector_top_k` [doc]; até 65.536 dimensões [doc]; índice exige tabela com ROWID ou chave primária única, sem chave composta [doc]. Filtro: SQL (o `vector_top_k` retorna candidatos e depois se junta com a tabela, então o filtro é pós-busca; reduz recall: não confirmado, verificar). Híbrido: via FTS5 do SQLite (não confirmado).
3. **Node**: `@libsql/client` (variante `/web` usa HTTP) [busca]; REST puro com `fetch` viável.
4. **Multi-tenancy**: um banco por projeto (Turso incentiva muitos bancos; Free tem 100) [doc] ou coluna `projeto_id`.
5. **Migração**: `INSERT ... ON CONFLICT DO UPDATE` em lote; export por keyset.
6. **Preço**: Free: 100 bancos, 5 GB, 500M leituras de linhas e 10M escritas por mês; Developer US$ 4,99/mês [doc]. Self-host: servidor `sqld` (Docker; não lido). Local: SQLite com extensão nativa.
7. **Riscos**: busca vetorial é recurso mais novo; filtro combinado menos maduro; poucos recursos de ranking híbrido.

### 1.8 Upstash Vector
1. **Auth**: REST com URL do índice + token (`Authorization: Bearer <token>`) [doc]. UI: URL, token (existe token somente-leitura, não confirmado), namespace. Região escolhida na criação.
2. **API**: REST: upsert, query, fetch, delete (por ids, prefixo ou filtro), range (paginação por cursor), info (contagem), reset; namespaces [de memória do doc; não lido em detalhe]. Filtro por metadado: sim (expressão SQL-like). Híbrido: sim (índices densos, esparsos ou híbridos) [doc]. Limites: grátis 1.536 dimensões; pago 3.072; metadado por vetor 48 KB; dados por vetor 1 MB; `topK` até 1.000 [doc]. Consistência eventual [doc].
3. **Node**: `@upstash/vector` oficial (leve, baseado em fetch) [doc]; REST puro trivial.
4. **Multi-tenancy**: namespaces: 100 no grátis, 10.000 no pago [doc]. Um namespace por projeto.
5. **Migração**: upsert por id (idempotente); `range` para exportar.
6. **Preço**: grátis: 10 mil consultas e 10 mil atualizações por dia, 1 GB, 200 milhões de vetores x dimensões; pago por uso (US$ 0,40 por 100 mil requisições; armazenamento US$ 0,25/GB, máx. 50 GB) [doc]. Sem self-host (não confirmado).
7. **Riscos**: dimensão máxima 1.536 no grátis exclui modelos de 3.072 (ex.: `text-embedding-3-large`); sem self-host; consistência eventual afeta verificação por contagem logo após a migração.

### 1.9 MongoDB Atlas Vector Search
1. **Auth**: usuário e senha de banco na string `mongodb+srv://` (driver) [conhecido]; lista de IPs permitidos. UI: URI de conexão, banco, coleção, nome do índice.
2. **API**: somente driver MongoDB (protocolo TCP proprietário): `bulkWrite`/`updateOne upsert`, agregação `$vectorSearch` com `filter` (campos precisam ser declarados no índice) [doc parcial]. A **Data API HTTP foi descontinuada em 30/09/2025** [busca], então NÃO há REST puro. Dimensões até 8.192 [busca]. Híbrido: sim, combinando `$vectorSearch` e Atlas Search (`$rankFusion`; não confirmado). Índice vetorial é criado por driver/UI e fica pronto de forma assíncrona.
3. **Node**: pacote `mongodb` (driver oficial, relativamente pesado, com dependências nativas opcionais).
4. **Multi-tenancy**: campo `projeto_id` + `filter`, ou coleção por projeto.
5. **Migração**: `bulkWrite` com `replaceOne upsert`; export com cursor (`_id` crescente).
6. **Preço**: M0 grátis (512 MB; máximo 3 índices entre busca e vetor) [busca]; pago por cluster. Self-host: Atlas Local (Docker, não lido) ou Community com busca (não confirmado).
7. **Riscos**: sem REST; driver pesado; índice assíncrono; lock-in do Atlas Search.

### 1.10 Elasticsearch e OpenSearch (kNN)
1. **Auth**: Elasticsearch: `Authorization: ApiKey <chave>` ou Basic (usuário/senha) [busca]; OpenSearch: HTTP Basic (usuário/senha) [doc]. UI: URL, chave ou usuário e senha, nome do índice. TLS com CA própria no self-host (tratar certificado).
2. **API**: REST puro: `_bulk` (index/update), `_search` com `knn` e `filter`, `_delete_by_query`, `_count`, `search_after` ou PIT para exportar. Filtro por metadado nativo. **Híbrido: melhor da categoria** (BM25 + kNN com RRF em retrievers) [busca]. Dimensões: `dense_vector` até 4.096 [busca]. OpenSearch: campo `knn_vector`, híbrido com `hybrid` query [doc].
3. **Node**: `@elastic/elasticsearch` (oficial); REST com `fetch` simples.
4. **Multi-tenancy**: campo `projeto_id` com filtro, aliases filtrados por projeto, ou índice por projeto.
5. **Migração**: `_bulk` com `_id` determinístico (idempotente); export com `search_after`/PIT.
6. **Preço**: Elastic Cloud por assinatura/trial (detalhes não confirmados); self-host Docker (Elasticsearch com licença Elastic/AGPL; OpenSearch Apache 2.0).
7. **Riscos**: operação pesada (JVM, memória); free tier permanente de nuvem: não confirmado; TLS no self-host.

### 1.11 Redis (vector search)
1. **Auth**: ACL: usuário e senha (`AUTH user pass`) [conhecido]; TLS em Redis Cloud. UI: host, porta, usuário, senha, TLS, prefixo de chave/índice.
2. **API**: protocolo RESP (TCP), sem REST: `HSET`/`JSON.SET` (upsert), `FT.CREATE` (índice FLAT/HNSW/SVS-VAMANA, `DIM`, `DISTANCE_METRIC` L2/IP/COSINE), `FT.SEARCH ... KNN ... DIALECT 2` com filtros TEXT/TAG/NUMERIC/GEO [doc], `FT.HYBRID` para texto + vetor [doc], `DEL`, `SCAN`/`FT.SEARCH` para export. Dimensão máxima: não confirmado. O `LIMIT` padrão é 10 (precisa `LIMIT 0 k`) [doc].
3. **Node**: `redis` ou `ioredis` (TCP); sem REST puro. Redis Cloud/Upstash Redis oferecem REST em alguns casos (não confirmado para busca vetorial).
4. **Multi-tenancy**: prefixo de chave por projeto + índice por prefixo, ou campo TAG `projeto_id`.
5. **Migração**: `HSET` por chave determinística (idempotente); export por `SCAN`.
6. **Preço**: não confirmado (Redis Cloud tem plano grátis de 30 MB, não verificado nesta consulta). Self-host: `redis/redis-stack`/Redis 8 em Docker.
7. **Riscos**: dados em memória (custo por GB alto); persistência depende de configuração; sem REST.

### 1.12 LanceDB (local e Cloud)
1. **Auth**: local sem auth (diretório); Cloud/Enterprise com API key e URI do banco [busca; detalhe não confirmado]. UI: URI (`db://...` ou caminho), chave, região (Cloud).
2. **API**: SDK (tabelas com `add`, `merge_insert` para upsert, `search` com `where`, `delete`, `count_rows`). Híbrido (vetor + FTS) suportado [doc parcial]. REST do Cloud: não confirmado. Limites: não confirmado.
3. **Node**: `@lancedb/lancedb` é módulo nativo (binários por plataforma, pesado para empacotar no Electron, exige rebuild/asar unpack); Cloud via REST: não confirmado.
4. **Multi-tenancy**: tabela por projeto ou coluna `projeto_id`.
5. **Migração**: `merge_insert` por id; export por scan.
6. **Preço**: formato aberto, uso local grátis; preço do Cloud: não confirmado.
7. **Riscos**: dependência nativa; Cloud menos documentado nesta consulta. Interessante como alternativa de **armazenamento local** futura, não como RAG online.

---

## 2. Tabela comparativa

| Provedor | Auth | REST puro com fetch? | Filtro por metadado | Híbrido | Dim. máx. documentada | Multi-tenancy | Grátis (documentado) | Self-host Docker |
|---|---|---|---|---|---|---|---|---|
| Qdrant | api-key/Bearer | Sim | Sim (payload) | Sim (esparso+denso) | não confirmado | coleção ou campo | 1 GB RAM, 4 GB disco, suspende em 1 sem. | Sim |
| Pinecone | Api-Key | Sim (host por índice) | Sim | Sim | não confirmado | namespaces | 2 GB, 5 índices, 100 ns/índice | Não |
| Weaviate | Bearer | Parcial (REST+GraphQL; cliente TS usa gRPC) | Sim | Sim | não confirmado | tenants nativos | 100 mil objetos, 1 GB RAM | Sim |
| Chroma | x-chroma-token | Sim (v2) | Sim | Sim | não confirmado | tenant/db/coleção | só US$ 5 de crédito | Sim |
| Milvus/Zilliz | Bearer usuário:senha ou chave | Sim (v2) | Sim (expressão) | Sim | não confirmado | db/coleção/partição | 5 GB, 5 coleções | Sim |
| Supabase pgvector | apikey+Bearer + RLS | Sim (PostgREST + rpc) | SQL completo | Sim (FTS + vetor) | índice 2.000 (4.000 halfvec) | RLS/colunas | 500 MB, pausa em 1 sem. | Sim (Postgres) |
| Neon / Postgres | usuário/senha (TCP) | Não (usa driver `pg`) | SQL completo | Sim | idem | schema/colunas | 0,5 GB (Neon) | Sim |
| Turso | Bearer | Sim (SQL via HTTP) | SQL (pós-busca, a verificar) | via FTS5 (não confirmado) | 65.536 | banco por projeto | 5 GB, 100 bancos | Parcial (sqld) |
| Upstash Vector | Bearer | Sim | Sim | Sim | 1.536 grátis / 3.072 pago | namespaces | 1 GB, 10 mil consultas/dia | Não |
| MongoDB Atlas | usuário/senha (driver) | Não (Data API descontinuada) | Sim | Sim (não confirmado em detalhe) | 8.192 | campo/coleção | M0 512 MB | Parcial |
| Elasticsearch/OpenSearch | ApiKey ou Basic | Sim | Sim | Sim (melhor) | 4.096 (ES) | índice/alias/campo | trial (não confirmado) | Sim |
| Redis | ACL (RESP) | Não | Sim | Sim (`FT.HYBRID`) | não confirmado | prefixo/TAG | não confirmado | Sim |
| LanceDB | chave (Cloud) | não confirmado | Sim | Sim | não confirmado | tabela/coluna | local grátis | local embutido |

---

## 3. Recomendação: ordem dos adaptadores

1. **Qdrant** (primeiro). REST puro, filtro rico por payload, scroll para exportar, ids UUID (casam com id determinístico), híbrido, free tier permanente e Docker oficial para teste local e compartilhamento em servidor próprio. Menor atrito e menor lock-in.
2. **Supabase/Postgres via PostgREST** (segundo). Muita gente já tem Supabase (o mesmo universo do dono), REST puro, RLS para equipes, híbrido via SQL, plano grátis. Custo: o usuário precisa aplicar um SQL de preparação (fornecer script copiável) e o adaptador chamar `rpc`. Variante `pg` direto (Neon/Postgres gerenciado) fica como extensão opcional, pois adiciona dependência TCP.
3. **Upstash Vector** (terceiro). O REST mais simples e a menor dependência; bom "grátis" para começar. Atenção ao teto de 1.536 dimensões no plano grátis.
4. **Pinecone** (quarto). Maior base instalada; REST simples; sem self-host, portanto o teste do contrato depende de stub.
5. **Weaviate** e **Chroma** e **Milvus/Zilliz**, nessa ordem de interesse (multi-tenancy nativo do Weaviate; Chroma é leve de testar localmente; Milvus tem esquema rígido).
6. **Elasticsearch/OpenSearch** (se houver cliente corporativo que já tenha). **Turso, Redis, MongoDB, LanceDB** ficam fora da primeira onda: Mongo e Redis não têm REST (exigem driver TCP), LanceDB é nativo, Turso tem filtro vetorial menos maduro.

Regra de implementação: todo adaptador da primeira onda usa só `fetch` (sem nova dependência), com `AbortSignal.timeout`, retry com backoff em 429/5xx e limite de concorrência.

---

## 4. Interface única `ArmazenamentoConhecimento`

```ts
export type MetricaDistancia = 'cosseno' | 'produto_interno' | 'euclidiana';

export interface Capacidades {
  hibrido: boolean;                 // texto + vetor na mesma consulta
  filtroNativo: boolean;            // filtro por metadado no servidor
  exportarComCursor: boolean;
  apagarPorFiltro: boolean;
  dimensaoMaxima?: number;
  loteMaximo: number;               // itens por upsert
  consistenciaEventual: boolean;    // contar logo após gravar pode divergir
  multiTenancy: 'namespace' | 'colecao' | 'campo' | 'banco';
}

export interface RegistroConhecimento {
  id: string;                       // determinístico (ver seção 7)
  vetor: number[];
  texto: string;                    // já redigido
  meta: {
    projeto_id: string;
    equipe_id?: string;
    tipo: string;                   // ex.: 'decisao' | 'doc' | 'codigo'
    origem: string;                 // caminho relativo, nunca absoluto
    hash_conteudo: string;
    modelo_embedding: string;
    dimensao: number;
    criado_em: string;              // ISO
  };
}

export type Filtro =
  | { e: Filtro[] } | { ou: Filtro[] }
  | { campo: string; igual: string | number | boolean }
  | { campo: string; em: Array<string | number> }
  | { campo: string; entre: [number, number] };

export interface ResultadoBusca { id: string; escore: number; texto: string; meta: RegistroConhecimento['meta']; }
export interface PaginaExportada { itens: RegistroConhecimento[]; proximoCursor: string | null; }

export interface ArmazenamentoConhecimento {
  testarConexao(): Promise<{ ok: boolean; versao?: string; motivo?: string }>; // nunca grava dados
  garantirColecao(p: { dimensao: number; metrica: MetricaDistancia; modeloEmbedding: string }): Promise<void>;
  upsert(lote: RegistroConhecimento[]): Promise<{ gravados: number }>;          // idempotente por id
  consultar(p: { vetor: number[]; texto?: string; filtro?: Filtro; k: number }): Promise<ResultadoBusca[]>;
  contar(filtro?: Filtro): Promise<number>;
  exportarPagina(cursor: string | null, tamanho?: number): Promise<PaginaExportada>;
  apagar(filtro: Filtro): Promise<{ apagados: number | 'desconhecido' }>;
  capacidades(): Capacidades;
}
```

Mapeamento e o que o adaptador esconde:

| Provedor | Id | Filtro | Métrica | Notas do adaptador |
|---|---|---|---|---|
| Qdrant | UUID v5 do id lógico (aceita só UUID/inteiro) | traduz para `must/should`; indexar `projeto_id`, `tipo` | `Cosine/Dot/Euclid` | `scroll` com `offset`; `count` exato com `exact:true` |
| Pinecone | string livre (limite de tamanho: não confirmado) | objeto `$eq/$in/$and` | definida na criação do índice | `namespace` = projeto; `contar` via stats (eventual); export via `list`+`fetch` |
| Weaviate | UUID v5 | filtro `where` | `cosine/dot/l2-squared` | tenant = projeto; propriedades precisam existir no esquema |
| Chroma | string | `where` com `$and/$or` | `cosine/ip/l2` (na criação da coleção) | resolver nome para UUID da coleção; `limit/offset` |
| Milvus/Zilliz | chave primária string/int (VARCHAR com tamanho máximo) | string de expressão (escapar aspas) | `COSINE/IP/L2` | esquema fixo; tamanho de campos |
| Supabase/pgvector | coluna `id text` PK | WHERE/JSONB via `rpc` | operador `<=>`, `<#>`, `<->` | normalizar para a mesma ordem (distância menor = melhor, converter para escore); dimensão acima de 2.000 pede `halfvec` |
| Upstash | string | expressão SQL-like | definida no índice | namespace = projeto; consistência eventual |
| Elasticsearch | `_id` | DSL `bool/filter` | `cosine/dot_product/l2_norm` | normalizar escore (ES soma 1 ao cosseno) |

Pontos gerais que o adaptador deve esconder: (a) escore em escala própria (converter para 0..1 maior = melhor); (b) normalização dos vetores (normalizar L2 antes de gravar se a métrica do servidor for produto interno); (c) limites de lote (fatiar por `capacidades().loteMaximo`); (d) filtro compilado a partir da AST única, com escape; (e) busca híbrida: se `hibrido=false`, a camada superior combina vetor local com texto (RRF no cliente) para não mudar o resultado percebido.

---

## 5. Política

### 5.1 Credenciais
- Guardar apenas com Electron `safeStorage` (Keychain no macOS, DPAPI no Windows, libsecret no Linux). Verificar `safeStorage.isEncryptionAvailable()`; no Linux sem `libsecret` (backend `basic_text`), recusar salvar e avisar.
- Nunca em JSON de configuração, log, `argv`, variável de ambiente persistida, evento IPC de volta ao renderer, mensagem de erro ou telemetria. O renderer envia o segredo uma vez ao processo principal e nunca o recebe de volta.
- A UI mostra mascarado (`••••` e os últimos 4 caracteres, ou só "configurada"); editar exige digitar de novo. No JSON de configuração ficam só campos não secretos (provedor, URL, coleção, região) e um `idSegredo` apontando para o cofre.
- "Testar sem salvar": `testarConexao()` roda com credenciais em memória, não grava nada, não cria coleção; só salva após o usuário confirmar. Erros de rede são sanitizados (remover header, URL com token, query string).
- Validar URL: exigir HTTPS (exceto `localhost`/rede privada, com aviso), recusar URL com credenciais embutidas. Permitir apagar o segredo ("esquecer") em um clique.

### 5.2 Consentimento
Tela obrigatória antes de qualquer envio, mostrando: provedor e URL de destino; região quando conhecida; quantidade de itens e tamanho; tipos de origem incluídos (com opção de excluir por tipo/pasta); amostra de N itens JÁ REDIGIDOS (o que será realmente enviado); aviso de que o conteúdo sai da máquina e será visível a quem tiver acesso à coleção. Segredos (chaves, tokens, senhas, `.env`, chaves privadas, caminhos absolutos com nome de usuário) são redigidos ANTES de gerar embedding e antes do envio, pelo mesmo redator usado nos logs. Consentimento é registrado por (provedor, coleção, versão da política) e vale só para aquele destino: mudou o destino, pede de novo.

### 5.3 Migração
1. **Dry-run**: conta, estima tamanho e custo de embeddings (se for reembutir), mostra a amostra redigida, valida dimensões e conflitos; não envia nada.
2. **Lotes com ponto de retomada**: fatiar por `loteMaximo`; gravar localmente um arquivo de progresso (id do último lote concluído, contagens), atualizado só depois de o lote ser confirmado. Upsert idempotente, então reexecutar é seguro.
3. **Verificação**: comparar contagem local x remota (com espera/reconsulta se `consistenciaEventual`) e checksum de amostra: sortear M ids, consultar e comparar `hash_conteudo`.
4. **Cópia local mantida**: a migração nunca apaga o índice local.
5. **Voltar para local**: botão que muda a configuração para o armazenamento local sem apagar nada; opcionalmente baixa o que existir só no remoto via `exportarPagina` (merge por id).
6. Executa em segundo plano (worker/processo utilitário) com progresso, pausa e cancelamento; backoff em 429.

---

## 6. Regra de coerência de embeddings
- Ao criar a coleção, gravar `modelo_embedding`, `dimensao` e `metrica` (como metadados da coleção quando suportado; senão como um registro reservado `__config__` com id fixo, ou um campo em todo registro).
- `garantirColecao` lê a configuração existente: se `dimensao`, `metrica` ou `modelo_embedding` divergirem, RECUSAR a gravação e mostrar a diferença. Nunca misturar modelos na mesma coleção, mesmo com dimensões iguais.
- Mudou o modelo: criar nova coleção versionada (`conhecimento_<projeto>_<modelo>_<dim>`), reembutir a partir do texto (guardado no registro) e só trocar o ponteiro depois de verificar contagem; a coleção antiga é mantida até o usuário aprovar a remoção.
- Consulta também embute com o mesmo modelo: recusar consulta se o modelo ativo difere do da coleção.
- Checar a dimensão máxima do provedor (`capacidades().dimensaoMaxima`) antes de migrar (ex.: Upstash grátis 1.536; índice pgvector 2.000).

## 7. IDs determinísticos
`id = UUIDv5(namespace_fixo_do_app, sha256(escopo + '\n' + tipo + '\n' + origem_relativa + '\n' + indice_do_trecho + '\n' + sha256(texto_normalizado)))`, em que `escopo` = `projeto_id` (e `equipe_id` quando existir). Texto normalizado: quebras de linha unificadas, espaços finais removidos, após a redação. Propriedades: mesmo conteúdo no mesmo escopo gera o mesmo id, então reenviar é no-op e duas pessoas do mesmo projeto não duplicam; conteúdo alterado gera id novo e o antigo é removido por `apagar` filtrando por `origem` + `hash_conteudo` diferente. Formato UUID satisfaz Qdrant e Weaviate; nos demais, usar a forma hexadecimal. Não incluir nome de usuário nem caminho absoluto no hash (para deduplicar entre pessoas).

## 8. Testes de aceitação do adaptador (contrato único)
Mesma suíte parametrizada rodando contra: (1) **stub local** em memória (sempre, em CI) e (2) servidor self-host em Docker quando houver (Qdrant, Weaviate, Chroma, Milvus, Postgres com pgvector, OpenSearch/Elasticsearch; Pinecone e Upstash só com stub, pois não há self-host). Não subir Docker agora.
1. `testarConexao` ok com credencial válida; falha clara (sem vazar segredo) com chave errada, URL inválida, timeout, TLS inválido.
2. `testarConexao` não cria nada (coleção continua inexistente).
3. `garantirColecao` é idempotente; recusa dimensão/métrica/modelo divergentes.
4. `upsert` de lote cheio e de lote acima do máximo (fatiado); reenviar o mesmo lote não muda `contar`.
5. `upsert` com mesmo id e conteúdo novo substitui (não duplica).
6. `consultar` retorna o vizinho esperado em conjunto pequeno com resultado conhecido, nas três métricas; escore normalizado e ordenado.
7. Filtro: `projeto_id` isola (projeto A nunca aparece na consulta de B); `tipo`, `em`, `entre`, `e/ou`; valor com aspas e caracteres especiais não quebra nem injeta.
8. Híbrido: com `hibrido=true` um termo raro sem proximidade semântica sobe; com `false` o fallback cliente produz o mesmo contrato.
9. `contar` com e sem filtro (aguardando consistência quando eventual).
10. `exportarPagina`: percorre todos os registros sem repetição nem perda, com páginas de tamanhos variados; cursor inválido dá erro claro; exportar e reimportar produz o mesmo conjunto de ids e checksums.
11. `apagar` por filtro remove só o escopo; apagar filtro vazio é recusado.
12. Retomada: interromper a migração no meio, reiniciar, terminar com contagem e checksum corretos.
13. 429 e 5xx: backoff e limite de tentativas; nenhuma credencial em logs, mensagens de erro, eventos ou snapshots (varredura automática de strings secretas semeadas).
14. Cancelamento (`AbortSignal`) interrompe sem corromper o ponto de retomada.
15. Payload com texto Unicode, texto grande no limite e meta no tamanho máximo documentado.

## 9. O que NÃO fazer
- Nunca enviar nada sem consentimento explícito do destino atual; nunca enviar antes de redigir segredos; nunca mandar caminhos absolutos ou nomes de usuário.
- Nunca guardar senha ou chave em texto (JSON, logs, `localStorage`, `argv`, env persistente, evento IPC, mensagem de erro, relatório).
- Nunca bloquear a UI na migração (processo/worker separado, progresso, cancelar).
- Nunca apagar o índice local ao migrar; nunca apagar remoto sem confirmação separada.
- Nunca misturar modelos de embedding ou dimensões numa coleção; nunca truncar vetor para caber.
- Nunca usar chave de administração/`service_role` quando existir chave com menos poder; avisar o usuário.
- Nunca usar ids aleatórios (quebra idempotência e deduplicação); nunca confiar em `contar` imediato em provedores de consistência eventual.
- Nunca somar cliente pesado (gRPC, módulos nativos, driver TCP) à primeira onda; nunca fixar um provedor no código fora do adaptador.
- Nunca tratar preço, limite ou endpoint desta ficha como definitivo: reconferir a documentação na implementação.

## 10. Lacunas ("não confirmado")
Limites de batch/payload e dimensão máxima de Qdrant, Weaviate, Chroma e Milvus; paths exatos REST de Qdrant, Upstash e Milvus (de memória); tamanho dos clientes npm de todos; endpoint REST e preço do LanceDB Cloud; plano grátis permanente de Redis e Elastic Cloud; filtro combinado ao `vector_top_k` do Turso e híbrido do Turso; `$rankFusion` do MongoDB; comportamento do `sqld` e do Atlas Local em Docker; token somente-leitura do Upstash; se Pinecone tem emulador local. Várias afirmações de preço e plano grátis (Qdrant, Pinecone, Zilliz, Turso REST) vêm de busca, não da página lida.
