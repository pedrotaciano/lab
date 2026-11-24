# Lab no Tern

Plugin do Tern que faz da Carly a secretária do lab: ela vê os times e os chats, passa trabalho aos agentes e traz o resultado. Você só fala com ela, por texto ou voz.

## Instalar

```sh
tern plugin link packages/lab/tern-plugin
tern plugin list          # lab 0.1.0 Lab — window  ready
```

Depois de editar `window.luau`: `tern plugin reload lab`. Tipos para o luau-lsp: `tern plugin types packages/lab/tern-plugin` (gera `tern.d.luau`; não versionar).

O plugin acha o servidor em `$LAB_CASA/servidor.json` (padrão `~/.lab/servidor.json`, escrito pelo `lab` ao subir); sem o arquivo, usa `http://127.0.0.1:4300`. Esse é o lab de entrada: com vários laboratórios (`laboratorios.json`), o plugin lê a lista em `/api/laboratorios` e cada um pelo proxy dele (`/l/<id>/api/…`).

## O que a Carly faz

`help("plugins.lab")` lista as funções:

- `estado()`: os laboratórios e, nos que estão no ar, os times (cada um com `lab`) e os chats, com status, atividade e pergunta pendente
- `abrir(time, texto, papel?, lab?)`: chat novo no time (id, nome ou trecho da pasta, em qualquer laboratório ou só em `lab`) com a primeira mensagem
- `mandar(chat_id, texto, lab?)`: mensagem a um chat que já existe
- `resultado(chat_id, lab?)`: espera até ~110 s o turno acabar e devolve a resposta
- `chat(chat_id, lab?)`: o chat inteiro, o laboratório e a última resposta completa
- `responder(chat_id, req_id, valor, lab?)`: responde a pergunta de um chat esperando
- `parar(chat_id, lab?)`, `fechar(chat_id, lab?)`, `criar_time(nome, pasta, lab?)`

`lab` é o id do laboratório (`mac`, `sinco`, `ec2`…). Sem ele, as funções de um chat acham o laboratório em que o chat está, e `criar_time` usa o `mac`.

As mensagens dela chegam aos chats com o cabeçalho `X-Lab-Autor: carly`.

No contexto de cada pergunta vai uma linha como `lab: 3 times · 4 chats · 2 trabalhando (…) · 1 esperando você (rosa em #mec-livros: …)`; com vários laboratórios, uma parte por laboratório (`labs — Mac: … ‖ EC2: … ‖ Sinco: fora do ar (sem túnel)`). Ela se atualiza a cada 3 s enquanto o lab responde (mais devagar quando está desligado).

Quando um chat passa a esperar você ou termina um turno, aparece um toast, com o laboratório na frente quando há mais de um (`EC2 · Miguel está esperando você em #api`). A Carly não começa conversa sozinha.
