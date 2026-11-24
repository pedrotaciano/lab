# Lab no Tern

Plugin do Tern que faz da Carly a secretária do lab: ela vê os times e os chats, passa trabalho aos agentes e traz o resultado. Você só fala com ela, por texto ou voz.

## Instalar

```sh
tern plugin link packages/lab/tern-plugin
tern plugin list          # lab 0.1.0 Lab — window  ready
```

Depois de editar `window.luau`: `tern plugin reload lab`. Tipos para o luau-lsp: `tern plugin types packages/lab/tern-plugin` (gera `tern.d.luau`; não versionar).

O plugin acha o servidor em `$LAB_CASA/servidor.json` (padrão `~/.lab/servidor.json`, escrito pelo `lab` ao subir); sem o arquivo, usa `http://127.0.0.1:4300`.

## O que a Carly faz

`help("plugins.lab")` lista as funções:

- `estado()`: times e chats, com status, atividade e pergunta pendente
- `abrir(time, texto, papel?)`: chat novo no time (id, nome ou trecho da pasta) com a primeira mensagem
- `mandar(chat_id, texto)`: mensagem a um chat que já existe
- `resultado(chat_id)`: espera até ~110 s o turno acabar e devolve a resposta
- `chat(chat_id)`: o chat inteiro e a última resposta completa
- `responder(chat_id, req_id, valor)`: responde a pergunta de um chat esperando
- `parar(chat_id)`, `fechar(chat_id)`, `criar_time(nome, pasta)`

As mensagens dela chegam aos chats com o cabeçalho `X-Lab-Autor: carly`.

No contexto de cada pergunta vai uma linha como `lab: 3 times · 4 chats · 2 trabalhando (…) · 1 esperando você (rosa em #mec-livros: …)`, atualizada a cada 3 s enquanto o lab responde (mais devagar quando está desligado).

Quando um chat passa a esperar você ou termina um turno, aparece um toast. A Carly não começa conversa sozinha.
