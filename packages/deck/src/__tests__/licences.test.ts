import { describe, expect, it } from "vitest";
import { ALLOWED_LICENCES, PORTED_VERSIONS, isAllowedLicence, licenceUrl } from "../licences.js";

describe("isAllowedLicence", () => {
  it.each(ALLOWED_LICENCES)("accepts the unported %s", (licence) => {
    expect(isAllowedLicence(licence)).toBe(true);
  });

  it.each([
    "CC-BY-2.0-UK",
    "CC-BY-2.5-AR",
    "CC-BY-3.0-BR",
    "CC-BY-SA-2.0-DE",
    "CC-BY-SA-2.5-ES",
    "CC-BY-SA-3.0-NL",
  ])("accepts the jurisdiction port %s", (licence) => {
    expect(isAllowedLicence(licence)).toBe(true);
  });

  it("accepts a port for every ported version of both licences", () => {
    for (const version of PORTED_VERSIONS) {
      expect(isAllowedLicence(`CC-BY-${version}-IT`)).toBe(true);
      expect(isAllowedLicence(`CC-BY-SA-${version}-IT`)).toBe(true);
    }
  });

  it.each([
    ["4.0, which has no ports", "CC-BY-4.0-BR"],
    ["4.0 share-alike, which has no ports", "CC-BY-SA-4.0-ES"],
    ["a version not on the list", "CC-BY-1.0-BR"],
    ["a lower-case country", "CC-BY-3.0-br"],
    ["a three-letter country", "CC-BY-3.0-BRA"],
    ["a one-letter country", "CC-BY-3.0-B"],
    ["a missing country after the hyphen", "CC-BY-3.0-"],
    ["a non-commercial licence", "CC-BY-NC-3.0-BR"],
    ["a no-derivatives licence", "CC-BY-ND-2.5-ES"],
    ["a lower-case licence", "cc-by-3.0-br"],
    ["a port of CC0", "CC0-BR"],
    ["surrounding whitespace", " CC-BY-3.0-BR"],
    ["fair use", "fair-use"],
    ["an empty string", ""],
  ])("rejects %s (%j)", (_, licence) => {
    expect(isAllowedLicence(licence)).toBe(false);
  });
});

describe("licenceUrl", () => {
  it.each([
    ["CC-BY-3.0-BR", "https://creativecommons.org/licenses/by/3.0/br/"],
    ["CC-BY-SA-2.5-ES", "https://creativecommons.org/licenses/by-sa/2.5/es/"],
    ["CC-BY-2.0-UK", "https://creativecommons.org/licenses/by/2.0/uk/"],
    ["CC-BY-SA-3.0-DE", "https://creativecommons.org/licenses/by-sa/3.0/de/"],
  ])("links the port %s to its own legal text", (licence, url) => {
    expect(licenceUrl(licence)).toBe(url);
  });

  it.each([
    ["CC-BY-2.0", "https://creativecommons.org/licenses/by/2.0/"],
    ["CC-BY-2.5", "https://creativecommons.org/licenses/by/2.5/"],
    ["CC-BY-3.0", "https://creativecommons.org/licenses/by/3.0/"],
    ["CC-BY-4.0", "https://creativecommons.org/licenses/by/4.0/"],
    ["CC-BY-SA-2.0", "https://creativecommons.org/licenses/by-sa/2.0/"],
    ["CC-BY-SA-2.5", "https://creativecommons.org/licenses/by-sa/2.5/"],
    ["CC-BY-SA-3.0", "https://creativecommons.org/licenses/by-sa/3.0/"],
    ["CC-BY-SA-4.0", "https://creativecommons.org/licenses/by-sa/4.0/"],
    ["CC0", "https://creativecommons.org/publicdomain/zero/1.0/"],
  ])("links the unported %s", (licence, url) => {
    expect(licenceUrl(licence)).toBe(url);
  });

  it("has no link for public domain", () => {
    expect(licenceUrl("PD")).toBeUndefined();
  });

  it("links a port and its unported original to different texts", () => {
    expect(licenceUrl("CC-BY-3.0-BR")).not.toBe(licenceUrl("CC-BY-3.0"));
  });

  it("gives every allowed licence except PD a creativecommons.org link", () => {
    for (const licence of ALLOWED_LICENCES) {
      if (licence === "PD") continue;
      expect(licenceUrl(licence)).toMatch(/^https:\/\/creativecommons\.org\/.+\/$/);
    }
  });

  it.each(["CC-BY-4.0-BR", "CC-BY-1.0", "fair-use"])("refuses %j rather than guess", (licence) => {
    expect(() => licenceUrl(licence)).toThrow(/not an allowed licence/);
  });
});
