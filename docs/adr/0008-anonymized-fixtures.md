# ADR-0008: Fixtures reais anonimizadas num repositório público

Status: aceito.

## Contexto

Testes contra HTML inventado provam pouco: as armadilhas reais (rótulos em
caixa normal, `&nbsp;` no meio do preço, CEP sem hífen, um pedido digital com
rótulos próprios, duas redações diferentes para "período vazio") só aparecem
no que a Amazon realmente entrega. Mas o repositório é público e a conta é de
uma pessoa.

## Decisão

Capturar as páginas cruas em `task/captures/` (fora do git, `0600`) e gerar
`test/fixtures/` com um anonimizador determinístico:

- valores, datas e quantidades nunca são tocados, então as identidades
  financeiras continuam verdadeiras: `140,53 + 8,90 - 8,90 - 26,47 = 114,06`
  ainda fecha, e o total do card da lista continua igual ao total geral do
  detalhe;
- identificadores mantêm forma e relações: o número do pedido mantém o prefixo
  (`702-`, `D01-`), o ASIN mantém o `B0`, e o mesmo pedido tem o mesmo número na
  lista e no detalhe;
- o vocabulário de interface fica intacto, protegido por uma lista de
  stopwords. Pseudonimizar `Total geral` deixaria os testes passando contra
  dados sem sentido;
- nome, endereço, cidade, CEP e últimos dígitos do cartão viram equivalentes; a
  URL pré-assinada da NF-e é removida, porque é uma credencial.

Duas passadas: os valores pessoais são aprendidos de todas as capturas antes
de qualquer reescrita, e depois substituídos globalmente, inclusive dentro de
atributos e JSON. Um passo restrito a nós de texto deixaria passar o endereço
que a Amazon repete no popover.

## Consequências

Os testes rodam sobre páginas reais e as junções entre fixtures sobrevivem. O
salt fica fora do git, então o mapa não é reversível por quem clona.

O guard do próprio anonimizador não basta: ele só vigia o que colheu. A prova
final é `test/local/captures.local.test.ts`, uma varredura independente que
procura os valores reais das capturas dentro de `test/fixtures/`. Foi ela que
pegou o nome vazando em minúsculas no cumprimento da barra de navegação, e um
ASIN colado a `%2C` numa URL, onde a fronteira de palavra do regex não dispara.
