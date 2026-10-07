import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WhatsAppText } from "@/modules/whatsapp/inbox-text";
import { parseIncomingRead } from "@/modules/whatsapp-qr/opt-out";

const html = (text: string) => renderToStaticMarkup(createElement(WhatsAppText, { text }));

describe("formatação do WhatsApp", () => {
  it("negrito, itálico, riscado e código", () => {
    expect(html("*NOSSA MISSÃO*")).toBe("<strong>NOSSA MISSÃO</strong>");
    expect(html("- *Opção 1*: Terça")).toBe("- <strong>Opção 1</strong>: Terça");
    expect(html("_Para não receber_ mais")).toBe("<em>Para não receber</em> mais");
    expect(html("~antigo~ e `x = 1`")).toBe("<s>antigo</s> e <code>x = 1</code>");
    expect(html("*_negrito itálico_*")).toBe("<strong><em>negrito itálico</em></strong>");
    expect(html("```bloco```")).toBe('<code class="wai-mono">bloco</code>');
  });

  it("não formata no meio de palavras nem marcadores soltos", () => {
    expect(html("2*3*4")).toBe("2*3*4");
    expect(html("nome_do_arquivo.pdf")).toBe("nome_do_arquivo.pdf");
    expect(html("* item")).toBe("* item");
  });

  it("links clicáveis e texto protegido", () => {
    expect(html("Veja https://igrow.com.br/x.")).toBe('Veja <a href="https://igrow.com.br/x" target="_blank" rel="noopener noreferrer nofollow">https://igrow.com.br/x</a>.');
    expect(html("<b>oi</b>")).toBe("&lt;b&gt;oi&lt;/b&gt;");
  });
});

describe("leitura feita no celular", () => {
  it("mensagem recebida lida em outro aparelho", () => {
    expect(parseIncomingRead({ event: "messages.update", data: { keyId: "ABC", fromMe: false, status: "READ" } })).toEqual({ messageId: "ABC" });
    expect(parseIncomingRead({ event: "messages.update", data: { keyId: "ABC", fromMe: true, status: "READ" } })).toBeNull();
    expect(parseIncomingRead({ event: "messages.update", data: { keyId: "ABC", fromMe: false, status: "DELIVERY_ACK" } })).toBeNull();
  });
});
