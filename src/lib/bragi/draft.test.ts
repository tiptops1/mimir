import { describe, expect, it } from "vitest";
import {
  buildContentRetrievalQuery,
  parseContentOutput,
  promptKeyForChannel,
  renderBrandVoiceBlock,
} from "./draft";

describe("parseContentOutput", () => {
  it("parses a valid JSON draft", () => {
    expect(parseContentOutput('{"title": "Titre", "body": "Corps"}')).toEqual({
      title: "Titre",
      body: "Corps",
    });
  });

  it("strips a ```json fence", () => {
    expect(
      parseContentOutput('```json\n{"title": "Titre", "body": "Corps"}\n```'),
    ).toEqual({ title: "Titre", body: "Corps" });
  });

  it("fails closed on null input", () => {
    expect(parseContentOutput(null)).toBeNull();
  });

  it("fails closed on garbage", () => {
    expect(parseContentOutput("désolé, je ne peux pas")).toBeNull();
  });

  it("fails closed on a missing title", () => {
    expect(parseContentOutput('{"body": "Corps"}')).toBeNull();
  });

  it("fails closed on an empty body", () => {
    expect(parseContentOutput('{"title": "Titre", "body": ""}')).toBeNull();
  });
});

describe("promptKeyForChannel", () => {
  it("builds the dotted per-channel key", () => {
    expect(promptKeyForChannel("linkedin_post")).toBe("bragi.content.draft.linkedin_post");
    expect(promptKeyForChannel("newsletter")).toBe("bragi.content.draft.newsletter");
  });
});

const fullVoice = {
  persona: "Le cabinet, à la première personne du pluriel.",
  tone: "Professionnel et chaleureux.",
  audience: "Dirigeants de TPE/PME.",
  language: "fr",
  doList: ["Vulgariser", "Vouvoyer"],
  dontList: ["Superlatifs"],
  vocabulary: ["accompagnement", "proximité"],
};

describe("renderBrandVoiceBlock", () => {
  it("renders every populated section", () => {
    const block = renderBrandVoiceBlock(fullVoice);
    expect(block).toContain("Persona : Le cabinet");
    expect(block).toContain("Ton : Professionnel");
    expect(block).toContain("Audience : Dirigeants");
    expect(block).toContain("Langue : fr");
    expect(block).toContain("À faire :\n- Vulgariser\n- Vouvoyer");
    expect(block).toContain("À éviter :\n- Superlatifs");
    expect(block).toContain("Vocabulaire privilégié : accompagnement, proximité");
  });

  it("omits empty lists entirely", () => {
    const block = renderBrandVoiceBlock({
      ...fullVoice,
      doList: [],
      dontList: [],
      vocabulary: [],
    });
    expect(block).not.toContain("À faire");
    expect(block).not.toContain("À éviter");
    expect(block).not.toContain("Vocabulaire");
  });
});

describe("buildContentRetrievalQuery", () => {
  it("joins topic and brief", () => {
    expect(
      buildContentRetrievalQuery({ channel: "newsletter", topic: "Sujet", brief: "Brief" }),
    ).toBe("Sujet\n\nBrief");
  });

  it("handles a missing brief", () => {
    expect(
      buildContentRetrievalQuery({ channel: "newsletter", topic: "Sujet", brief: null }),
    ).toBe("Sujet");
  });

  it("caps the query length", () => {
    const query = buildContentRetrievalQuery({
      channel: "newsletter",
      topic: "Sujet",
      brief: "x".repeat(5000),
    });
    expect(query.length).toBe(1500);
  });
});
