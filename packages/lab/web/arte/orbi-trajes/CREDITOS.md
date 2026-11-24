# Trajes

As peças desta pasta (52: chapéus, capacetes, coroa, turbante, gorros e cachecol, cabelos,
máscara, tapa-olho e óculos, camisas, corpete, túnicas, jalecos, capa, macacão, faixa com
cimitarra, beca, calças, vestido, meia listrada, botas e pés), as 3 peles de história (azul,
laranja, amarela) e os 20 trajes de `trajes.json` (astronauta, chef, pirata, cientista, hacker,
inverno, festa junina, super-herói, robô, mago; princesa, encanador, príncipe do deserto, herói da
floresta, aprendiz de bruxo, pequenino da colina, ajudante amarelo, elfo do Noel, duendinho azul,
chocolateiro) são desenho nosso, feito por `scripts/gerar-trajes.mjs`, no formato e sobre as
formas dos bonecos do Pixel Agents: cada camisa nova é a camisa de manga longa deles repintada,
cada chapéu fica onde fica o boné deles, quadro a quadro (3 direções × 8 quadros de 16 × 32).

**Arquétipos, não personagens.** Os dez da segunda leva (19/11/2026) lembram figuras de
histórias só pela silhueta e pelas cores, desenhados do nosso jeito e com nomes nossos: nenhum
pixel, logotipo, letra no boné, brasão, marca ou nome de personagem protegido, no desenho ou no
texto (`tests/trajes-turma.test.mjs` confere os nomes). O laboratório é aberto e vai para escolas
e para o MEC; um traje novo segue a mesma regra.

- **Base:** Pixel Agents, por Pablo De Lucca. Licença MIT — `../pixel-agents/LICENSE`.
  Fonte: https://github.com/pixel-agents-hq/pixel-agents (os bonecos deles partem do MetroCity,
  de JIK-A-4).
- **Referência dos motivos** (chapéu de mago, capuz, capacete, chapéu de pirata): "Roguelike
  Characters", por Kenney (www.kenney.nl). Licença: CC0 1.0 —
  https://creativecommons.org/publicdomain/zero/1.0/ (cópia em
  `LICENSE-kenney-roguelike-characters.txt`). Fonte: https://kenney.nl/assets/roguelike-characters
  (espelho: https://opengameart.org/content/roguelike-character-pack). Nenhum pixel copiado: o
  pacote é só de frente e em 16 × 16; os desenhos foram refeitos no tamanho e nas três vistas da
  sala.

Olhados e não usados: o "MetroCity – Free Top Down Character Pack" de JIK-A-4
(https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) casaria com a sala, mas a página
só diz "You can use it as you wish", sem uma licença; os pacotes LPC (Liberated Pixel Cup) são
CC-BY-SA/GPL, e o share-alike passaria para a arte daqui.

Para mudar uma peça: edite o desenho em `scripts/gerar-trajes.mjs` e rode
`node scripts/gerar-trajes.mjs` (precisa de ffmpeg).

Correção de 18/11/2026: o chapéu de mago declara `ocultaAcima`, a altura da aba
em cada um dos 24 quadros, derivada pelo gerador. A composição oculta cabeça e cabelo
apenas acima da aba, antes de desenhar o chapéu; preserva o cabelo abaixo dela.
As outras peças, os PNGs 128 × 96 e os códigos ORBI não mudam.
O gorro com guizo do elfo (19/11/2026) declara o mesmo `ocultaAcima`, na altura da faixa vermelha.
