import { describe, expect, test } from "bun:test";
import { dedupeRecipient, parseAddress } from "../src/domain/address.js";
import { addMonths, dayFromEpochMs, parseDateBR, stripAccents } from "../src/domain/dates.js";
import { money, parseBrl, toDecimal } from "../src/domain/money.js";
import { parsePayment } from "../src/domain/payment.js";
import { isCancelledStatus, isFinalStatus, parseStatus } from "../src/domain/status.js";

describe("parseBrl", () => {
  test("reads the spacing of both surfaces", () => {
    // Subtotal rows have a space, the accessible price (a-offscreen) does not.
    expect(parseBrl("R$ 246,80")).toBe(24680);
    expect(parseBrl("R$246,80")).toBe(24680);
  });

  test("handles thousands and a missing cents part", () => {
    expect(parseBrl("R$ 1.234,56")).toBe(123456);
    expect(parseBrl("R$ 958,80")).toBe(95880);
    expect(parseBrl("R$ 159")).toBe(15900);
    expect(parseBrl("R$ 0,00")).toBe(0);
  });

  test("reward points arrive negative", () => {
    expect(parseBrl("-R$ 0,96")).toBe(-96);
    expect(parseBrl("R$ -0,96")).toBe(-96);
  });

  test("free shipping is zero, but junk is null and never zero", () => {
    expect(parseBrl("Grátis")).toBe(0);
    expect(parseBrl("gratuito")).toBe(0);
    expect(parseBrl("")).toBeNull();
    expect(parseBrl(null)).toBeNull();
    expect(parseBrl("Vendido por: Amazon.com.br")).toBeNull();
    expect(parseBrl("Entregue em 2 de dezembro")).toBeNull();
  });

  test("finds the amount inside a longer sentence", () => {
    expect(parseBrl("Em 6x de R$ 40,99 sem juros")).toBe(4099);
  });

  test("converts to a decimal only at the boundary", () => {
    expect(toDecimal(24680)).toBe(246.8);
    expect(toDecimal(-96)).toBe(-0.96);
    expect(money(24680)).toEqual({ amount: 246.8, currency: "BRL" });
    expect(money(null)).toBeNull();
  });
});

describe("parseDateBR", () => {
  const now = new Date("2026-09-07T12:00:00Z");

  test("reads a full label", () => {
    expect(parseDateBR("22 de dezembro de 2024", now)).toBe("2024-12-22");
    expect(parseDateBR("3 de julho de 2025", now)).toBe("2025-07-03");
    expect(parseDateBR("1º de março de 2024", now)).toBe("2024-03-01");
  });

  test("a year-less label in the past stays in this year", () => {
    expect(parseDateBR("Entregue em 2 de agosto", now)).toBe("2026-08-02");
  });

  test("a year-less label in the future belongs to last year", () => {
    expect(parseDateBR("Entregue em 2 de dezembro", now)).toBe("2025-12-02");
  });

  test("returns null rather than guessing", () => {
    expect(parseDateBR("Entregue", now)).toBeNull();
    expect(parseDateBR("32 de dezembro de 2024", now)).toBeNull();
    expect(parseDateBR("22 de brumário de 2024", now)).toBeNull();
    expect(parseDateBR(null, now)).toBeNull();
  });

  test("helpers", () => {
    expect(stripAccents("Março")).toBe("Marco");
    expect(dayFromEpochMs(Date.UTC(2026, 8, 7))).toBe("2026-09-07");
    expect(addMonths("2026-09-07", 3)).toBe("2026-12-07");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 2)).toBe("2027-02-15");
  });
});

describe("parseStatus", () => {
  test("matches stems, not exact strings", () => {
    expect(parseStatus("Entregue em 2 de dezembro")).toBe("delivered");
    expect(parseStatus("Pedido cancelado")).toBe("cancelled");
    expect(parseStatus("Você cancelou este pedido")).toBe("cancelled");
    expect(parseStatus("Reembolso concluído")).toBe("returned");
    expect(parseStatus("A caminho")).toBe("shipped");
    expect(parseStatus("Preparando para envio")).toBe("processing");
  });

  test("empty or unknown text is unknown, never a guess", () => {
    expect(parseStatus("")).toBe("unknown");
    expect(parseStatus(null)).toBe("unknown");
    expect(parseStatus("Avalie o produto")).toBe("unknown");
  });

  test("final statuses never need another request", () => {
    expect(isFinalStatus("delivered")).toBe(true);
    expect(isFinalStatus("cancelled")).toBe(true);
    expect(isFinalStatus("shipped")).toBe(false);
    expect(isCancelledStatus("cancelled")).toBe(true);
  });
});

describe("parsePayment", () => {
  test("reads the real block: card, last four and instalments", () => {
    const payment = parsePayment(
      "Forma de pagamento Mastercard  terminando em 1234 Em 6x de R$ 40,99 sem juros Endereço de cobrança",
    );
    expect(payment).toMatchObject({
      method: "credit_card",
      brand: "Mastercard",
      last4: "1234",
      installments: 6,
      installmentCents: 4099,
      interestFree: true,
    });
    // 6 x 40,99 = 245,94, which is the order total within rounding.
    expect(payment.installments! * payment.installmentCents!).toBe(24594);
  });

  test("paid outright is one instalment", () => {
    expect(parsePayment("Visa terminando em 4321 à vista")).toMatchObject({
      brand: "Visa",
      installments: 1,
      installmentCents: null,
    });
  });

  test("with interest is recorded as such", () => {
    expect(parsePayment("Elo terminando em 1111 Em 10x de R$ 53,55 com juros")).toMatchObject({
      installments: 10,
      installmentCents: 5355,
      interestFree: false,
    });
  });

  test("keeps the raw block so a wrong parse is auditable", () => {
    expect(parsePayment("  Algo   estranho  ").raw).toBe("Algo estranho");
    expect(parsePayment("").raw).toBe("");
    expect(parsePayment("").method).toBeNull();
  });

  test("non-card methods are detected by their own words", () => {
    expect(parsePayment("Pix").method).toBe("pix");
    expect(parsePayment("Boleto bancário").method).toBe("boleto");
    expect(parsePayment("Vale-presente").method).toBe("gift_card");
    expect(parsePayment("Pontos de recompensa").method).toBe("points");
  });

  // The words exist in the page's vocabulary but no order in the reference
  // account used them, so the exact strings are unverified.
  test.todo("confirm the exact Pix and boleto wording against a real order", () => {
    expect(parsePayment("Pix").raw).toBe("Pix");
  });
});

describe("parseAddress", () => {
  test("anchors on the CEP line", () => {
    const address = parseAddress(
      "Nome Sobrenome\nRua Exemplo da Silva 19\nComplemento de referência\nCidade Exemplo, RS 95690-000",
    );
    expect(address).toMatchObject({
      recipient: "Nome Sobrenome",
      lines: ["Rua Exemplo da Silva 19", "Complemento de referência"],
      city: "Cidade Exemplo",
      state: "RS",
      postalCode: "95690-000",
    });
  });

  test("survives an address without a CEP", () => {
    const address = parseAddress("Nome Sobrenome\nRua Exemplo 19");
    expect(address).toMatchObject({ recipient: "Nome Sobrenome", postalCode: null, city: null });
    expect(address?.lines).toEqual(["Rua Exemplo 19"]);
  });

  test("drops the recipient duplicated by the popover", () => {
    const address = parseAddress("Nome Sobrenome\nNome Sobrenome\nRua Exemplo 19");
    expect(dedupeRecipient(address!).lines).toEqual(["Rua Exemplo 19"]);
  });

  test("empty text is null", () => {
    expect(parseAddress("")).toBeNull();
    expect(parseAddress(null)).toBeNull();
  });
});
