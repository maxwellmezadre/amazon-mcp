import { Type } from "@sinclair/typebox";

// Schema fragments shared by several tools, so a description is written once.

export const compactField = Type.Optional(
  Type.Boolean({
    description:
      "Devolve apenas os campos essenciais, para economizar contexto (default AMAZON_COMPACT)",
  }),
);

export const dayField = (description: string) =>
  Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description }));

export const limitField = (max: number, fallback: number) =>
  Type.Optional(
    Type.Integer({ minimum: 1, maximum: max, description: `Máximo de itens (default ${fallback})` }),
  );

export const offsetField = Type.Optional(
  Type.Integer({ minimum: 0, description: "Itens a pular (paginação)" }),
);

/**
 * `702-1234567-1234567` for retail, `D01-…` for digital. The pattern is also a
 * guard: the `session-id` cookie has this exact shape, so anything reaching a
 * tool is at least the right kind of string.
 */
export const ORDER_ID_PATTERN = "^[A-Z]?\\d{2,3}-\\d{7}-\\d{7}$";

export const orderIdField = Type.String({
  pattern: ORDER_ID_PATTERN,
  description: "Número do pedido na Amazon, como aparece em `list_orders` (ex.: 702-1234567-1234567)",
});
