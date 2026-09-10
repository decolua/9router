/**
 * Vertex SA JSON key validation — guards the jose RS256 requirement:
 * RSA key must be 2048 bits or larger, otherwise jose throws
 * "RS256 requires key modulusLength to be 2048 bits or larger".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const RSA1024 = `-----BEGIN RSA PRIVATE KEY-----
MIICXAIBAAKBgQC9s2WlG2fi5V58yOhlNNWMSUBBNGl2vnhhhSNKIizroY0pyg2u
F4e6E8vFFW7UFea1+IrdxanVwa7Qw6wFAhGOoAt+GbRdXNjaLzRUNZdGMb9cyAiu
4wt7eYon+hbSe5Na5KcWiO0Nxfe2aZyaT0K5T2ku8kp6WF2URqebzKQUiwIDAQAB
AoGATvF+JkSOafz74kAVfjCLgdLl+3ydOv4uyJ6IPgyU1wYm4bIlGULPh98/GGg/
8+CdXzLsTzg34i2020nipz7iINj8/YbHA7aml4+s/wtvMFsMSulEARouBkQrg/To
HdfQnjY3ZzouU2vbjnBiel1NqmQDhG2zGUMVVOkZ/ACWULECQQD1Z27lxzmykOWw
oVsr8CGaJuPs6SGfoaG4AXfbAqc8bhHPDYCDqpMq9yLbz1sL8I/cVrESlr6i4UA2
GnKoEwbDAkEAxeQ/09S1+hBnQI1CTiUABRV5NRgm2D7r75rz+3v1Z+qltm7feXEF
cy9DLV/PuXD4tUIAm6T8vy0pfhMuZNoumQJAFgpKHXz9I5p75pc3VwTkH7Iqelad
3HZpzdrj5tmgJ39DPjNaPXkOaqdzjAZdiP78DLAEi0TarkpIuBM8BPhgfQJBAI1+
4tSIJ4Yh7HIPjvVpJ1Z7QCtilYPRmcm9Ne7/dz1SXiLPrCKdWZQ+mv36oACscmjI
RL8FfWME28I13Npn1yECQC3V5vfU9bgeoE/dXm+1xL8sQmCVy5rubDMqz51qoal+
7aLclziWIE3R9VTOHQmh4P8lMZXAyzcy6Z5zasZUwpQ=
-----END RSA PRIVATE KEY-----`;

const RSA2048 = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0DtJ2qNJT1riQwv6u5E3T5jhVx2R1a+FEAEg5UkmvCosKP5n
bRPPHpaWbyOFAenC55UOeWx9YNXwfZYZziGWycfsmcCPdDjLB7/6N8xedAtyfP01
moXyGLeICl9Kfz3pXJ1+it5I4dNXhy5Wsxwl3d4upWV+WbnANxW22EdwfNackFkH
ahy7OClXBg8M2kist6ZZUNDtuVAtSl/Rqa6evIlnc13jWxdbqCJKVRMwIN6W9Bp1
cCtu9C8dr+kBTEPOlXlZ3PwoWK/jesU6fdV78LYm5uEb6rLAR4rS5fM9s8XEvgG5
WUHYlYmXki/+VVtySmOqH6elh2XzOyiKCJTemQIDAQABAoIBADBfFXDsrYL5ocXh
aoVX3nlnEjGidNYmx8pH+NRKge0D/u4m6u+zwlFgueFnZuZi3xvczFf4k8eC6zLB
Q41W0ChfgN7WlHxzFPbf6cg8eVSLtDTEvUcABpUnTTrbl/qm7ybMjzDDIjsTVSnZ
4doJl+JKUpupUAiX1cb2DFuBfOgCp2FUnnRtzuAkZOjf1u1P0zeuQvj28dkGefPC
wVvTPia3Cy3bGuG6qt0JSGPzUa70qFrisL1lu1fbAUnmrBxYjDuFltsHytqUvsmb
QDJvuiapzDVKsc9pDVqErZRdlBvOUlqTxPhO+wJyiTgei1MqwX+4lGgE5EzEVfYQ
c4pasYECgYEA67yTEwDaDHY8TE06EV8lsNkWhMYLRt7HWDf6nD1KLMP14skLFMl5
t8G4sKppMh+ykUYaJrowy5/DhYKPD5IhLDHK2p8OEGOBA06P5xf2DfyW26CM/Nhj
HrA9O4wLnH5azc69LCut+H9pN3qQOddhCPyEhSi/ITwFHMoMnGZ9Sg0CgYEA4iF2
DQLzQfYzcp7sZJetRB4IUcweY/7ZxBWLdkm+AVdUIBfa7uhs3XtC5obRcplY1JYB
MCweAWcln1vlv6Icki2Sedm7adfdD9JyPCoCu3d8eJ/wuRENXXYtCN9MyLxOEqGt
wdfRs2Z6lGCswi0pSCtmAMRwlTd1PVAK84FMP70CgYAVkU8zceSBN2AU6wvhAv+D
ypjQ1P27Ii7C13xKRyE+Lz+T3CjzYeuM8GBhaXXubA/+UpeZ63cDaj6NPICyQABg
9r1Ee0DiJvhqwQlRb1PHu9Bhj7LWf0WyTRWNGScGzlioc73DCMwF7EJIHSKM6DOs
is3lEPFLrR4aoDG/LXFREQKBgETH5L5kbVVc650rlb+rGvqjH+ixa3UC6X3pB7h9
CZwi0eXJG8CbVbGwclLoIwD2f7x5u/bJFH9cvmbQbvtw9bvIvMrvXT/+drD/U9vU
82vOFkAidff0pdoNvfj64sIT9LNaFh3l5VTqENLc7O9LCUl4WdhV5+CbM7/ofsw+
QdEJAoGBAKY3PgLz3WLigXL9hhnmk7zKvxsRv3adXre2HEjHIKhnwNZ78SgOP4+6
L8srgUm7bGwLK4DuLpabeGDlROdu6OV6V3ecKRYtYE8IxJyhaa5fj4KTIY79Nt29
9NEkC5xLCFtQCDk4hHf2fr/Jc2OyMXYY/jG3lfayHOCQlUYQlAJr
-----END RSA PRIVATE KEY-----`;

const EC256 = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIF9II7FMdqoQhbohjGGnhMdzn5Fswb2Vuqty2g6dqKjDoAoGCCqGSM49
AwEHoUQDQgAEBukiJhenCjETxA2sKkbuybvPvb9FWzKK8ZEdydxVDwnQ9wTJdm7G
8tTPLEDhTYNgh+IvsTNE1GsiKcNBIaoUnw==
-----END EC PRIVATE KEY-----`;

describe("validateVertexSaKey", () => {
  it("accepts RSA-2048 private keys (jose RS256 requirement)", async () => {
    const { validateVertexSaKey } = await import("../../open-sse/services/tokenRefresh.js");
    expect(validateVertexSaKey({ private_key: RSA2048 })).toBeNull();
  });

  it("rejects RSA keys below 2048 bits with a user-facing message", async () => {
    const { validateVertexSaKey } = await import("../../open-sse/services/tokenRefresh.js");
    const err = validateVertexSaKey({ private_key: RSA1024 });
    expect(err).toMatch(/RSA-2048 or larger/);
    expect(err).toMatch(/1024 bits/);
  });

  it("rejects non-RSA keys", async () => {
    const { validateVertexSaKey } = await import("../../open-sse/services/tokenRefresh.js");
    expect(validateVertexSaKey({ private_key: EC256 })).toMatch(/must be RSA/);
  });

  it("rejects garbage and missing private_key", async () => {
    const { validateVertexSaKey } = await import("../../open-sse/services/tokenRefresh.js");
    expect(validateVertexSaKey({ private_key: "not-a-key" })).toMatch(/not a valid PEM/);
    expect(validateVertexSaKey({})).toMatch(/missing private_key/);
  });
});

describe("refreshVertexToken — invalid SA key", () => {
  const originalFetch = global.fetch;

  beforeEach(() => { global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => ({}) }); });
  afterEach(() => { global.fetch = originalFetch; });

  it("returns null without minting when private key is below 2048 bits", async () => {
    const { refreshVertexToken } = await import("../../open-sse/services/tokenRefresh.js");
    const log = { error: vi.fn(), debug: vi.fn(), info: vi.fn() };
    const result = await refreshVertexToken(
      { client_email: "test@example.com", private_key: RSA1024 },
      log
    );
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
