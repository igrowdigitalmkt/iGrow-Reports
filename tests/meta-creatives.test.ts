import { describe, expect, it } from "vitest";
import { adBelongsToAccounts, safeMetaUrl, toAdResults, toCampaignCreative } from "@/modules/meta/creatives";

describe("criativos de campanha", () => {
  it("só aceita endereços https da Meta e do Instagram", () => {
    expect(safeMetaUrl("https://scontent.fbcdn.net/v/t45/a.jpg?x=1")).toContain("scontent.fbcdn.net");
    expect(safeMetaUrl("https://www.instagram.com/p/ABC/")).toBe("https://www.instagram.com/p/ABC/");
    expect(safeMetaUrl("http://scontent.fbcdn.net/a.jpg")).toBeNull();
    expect(safeMetaUrl("https://evil.example.com/fbcdn.net/a.jpg")).toBeNull();
    expect(safeMetaUrl("https://fbcdn.net.evil.com/a.jpg")).toBeNull();
    expect(safeMetaUrl("javascript:alert(1)")).toBeNull();
    expect(safeMetaUrl(undefined)).toBeNull();
  });
  it("monta imagem, link do post e pré-visualização do anúncio", () => {
    const creative = toCampaignCreative({ id: "9", name: "Anúncio 01", effective_status: "paused", preview_shareable_link: "https://fb.me/abc",
      creative: { thumbnail_url: "https://scontent.fbcdn.net/t.jpg", image_url: "https://scontent.fbcdn.net/full.jpg", effective_object_story_id: "123_456" } });
    expect(creative).toEqual({ adId: "9", name: "Anúncio 01", status: "PAUSED", type: "imagem", results: null, imageUrl: "https://scontent.fbcdn.net/full.jpg",
      thumbnailUrl: "https://scontent.fbcdn.net/t.jpg", postUrl: "https://www.facebook.com/123_456", previewUrl: "https://fb.me/abc" });
  });
  it("prefere o link do Instagram, usa a miniatura quando não há imagem e reconhece vídeo", () => {
    const creative = toCampaignCreative({ id: "9", creative: { thumbnail_url: "https://scontent.fbcdn.net/t.jpg", video_id: "77", instagram_permalink_url: "https://www.instagram.com/p/XYZ/", effective_object_story_id: "123_456" } });
    expect(creative).toMatchObject({ type: "video", imageUrl: "https://scontent.fbcdn.net/t.jpg", postUrl: "https://www.instagram.com/p/XYZ/", status: null });
  });
  it("descarta ID de post fora do formato e endereços de outro domínio", () => {
    const creative = toCampaignCreative({ id: "9", creative: { effective_object_story_id: "../../x", image_url: "https://evil.example.com/a.jpg" }, preview_shareable_link: "https://evil.example.com/p" });
    expect(creative).toMatchObject({ postUrl: null, imageUrl: null, previewUrl: null });
  });
  it("calcula o resultado do anúncio: gasto, cliques, cadastros e custo por cadastro", () => {
    const row = { ad_id: "9", spend: "341.54", impressions: "37069", inline_link_clicks: "556", actions: [{ action_type: "link_click", value: "556" }, { action_type: "lead", value: "14" }] };
    expect(toAdResults(row)).toEqual({ spend: 341.54, impressions: 37069, linkClicks: 556, leads: 14, costPerLead: 24.4 });
    expect(toCampaignCreative({ id: "9" }, row).results).toMatchObject({ leads: 14, costPerLead: 24.4 });
  });
  it("sem cadastros não há custo por cadastro; valores estranhos viram zero; sem linha da Meta o resultado fica vazio", () => {
    expect(toAdResults({ ad_id: "9", spend: "70.94", actions: [] })).toEqual({ spend: 70.94, impressions: 0, linkClicks: 0, leads: 0, costPerLead: null });
    expect(toAdResults({ ad_id: "9", spend: "abc", impressions: "-5", actions: [{ action_type: "lead", value: "x" }] })).toEqual({ spend: 0, impressions: 0, linkClicks: 0, leads: 0, costPerLead: null });
    expect(toAdResults(undefined)).toBeNull();
  });
  it("só devolve anúncio de conta vinculada ao cliente", () => {
    expect(adBelongsToAccounts({ account_id: "3495961267209134" }, ["act_3495961267209134"])).toBe(true);
    expect(adBelongsToAccounts({ account_id: "act_3495961267209134" }, ["act_3495961267209134"])).toBe(true);
    expect(adBelongsToAccounts({ account_id: "910504401812356" }, ["act_3495961267209134"])).toBe(false);
    expect(adBelongsToAccounts({}, ["act_3495961267209134"])).toBe(false);
  });
});
