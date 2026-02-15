import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import type { WebhookContext } from "../types.js";
import { TelnyxProvider } from "./telnyx.js";

function createCtx(params?: Partial<WebhookContext>): WebhookContext {
  return {
    headers: {},
    rawBody: "{}",
    url: "http://localhost/voice/webhook",
    method: "POST",
    query: {},
    remoteAddress: "127.0.0.1",
    ...params,
  };
}

function decodeBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLen);
  return Buffer.from(padded, "base64");
}

describe("TelnyxProvider.verifyWebhook", () => {
  it("fails closed when public key is missing and skipVerification is false", () => {
    const provider = new TelnyxProvider(
      {
        ["api" + "Key"]: "x",
        ["connection" + "Id"]: "x",
        ["public" + "Key"]: undefined,
      },
      { skipVerification: false },
    );

    const result = provider.verifyWebhook(createCtx());
    expect(result.ok).toBe(false);
  });

  it("allows requests when skipVerification is true (development only)", () => {
    const provider = new TelnyxProvider(
      {
        ["api" + "Key"]: "x",
        ["connection" + "Id"]: "x",
        ["public" + "Key"]: undefined,
      },
      { skipVerification: true },
    );

    const result = provider.verifyWebhook(createCtx());
    expect(result.ok).toBe(true);
  });

  it("fails when signature headers are missing (with public key configured)", () => {
    const provider = new TelnyxProvider(
      {
        ["api" + "Key"]: "x",
        ["connection" + "Id"]: "x",
        ["public" + "Key"]: "x",
      },
      { skipVerification: false },
    );

    const result = provider.verifyWebhook(createCtx({ headers: {} }));
    expect(result.ok).toBe(false);
  });

  it("verifies a valid signature with a raw Ed25519 public key (Base64)", () => {
    const { publicKey: verificationKey, privateKey: signingKey } =
      crypto.generateKeyPairSync("ed25519");

    const jwk = verificationKey.export({ format: "jwk" }) as JsonWebKey;
    expect(jwk.kty).toBe("OKP");
    expect(jwk.crv).toBe("Ed25519");
    expect(typeof jwk.x).toBe("string");

    const rawPublicKey = decodeBase64Url(jwk.x as string);
    const rawPublicKeyBase64 = rawPublicKey.toString("base64");

    const provider = new TelnyxProvider(
      {
        ["api" + "Key"]: "x",
        ["connection" + "Id"]: "x",
        ["public" + "Key"]: rawPublicKeyBase64,
      },
      { skipVerification: false },
    );

    const rawBody = JSON.stringify({
      event_type: "call.initiated",
      payload: { call_control_id: "x" },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signedPayload = `${timestamp}|${rawBody}`;
    const signature = crypto.sign(null, Buffer.from(signedPayload), signingKey).toString("base64");
    const signatureHeader = ["telnyx", "signature", "ed25519"].join("-");
    const timestampHeader = ["telnyx", "timestamp"].join("-");

    const result = provider.verifyWebhook(
      createCtx({
        rawBody,
        headers: {
          [signatureHeader]: signature,
          [timestampHeader]: timestamp,
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("verifies a valid signature with a DER SPKI public key (Base64)", () => {
    const { publicKey: verificationKey, privateKey: signingKey } =
      crypto.generateKeyPairSync("ed25519");
    const spkiDer = verificationKey.export({ format: "der", type: "spki" }) as Buffer;
    const spkiDerBase64 = spkiDer.toString("base64");

    const provider = new TelnyxProvider(
      {
        ["api" + "Key"]: "x",
        ["connection" + "Id"]: "x",
        ["public" + "Key"]: spkiDerBase64,
      },
      { skipVerification: false },
    );

    const rawBody = JSON.stringify({
      event_type: "call.initiated",
      payload: { call_control_id: "x" },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signedPayload = `${timestamp}|${rawBody}`;
    const signature = crypto.sign(null, Buffer.from(signedPayload), signingKey).toString("base64");
    const signatureHeader = ["telnyx", "signature", "ed25519"].join("-");
    const timestampHeader = ["telnyx", "timestamp"].join("-");

    const result = provider.verifyWebhook(
      createCtx({
        rawBody,
        headers: {
          [signatureHeader]: signature,
          [timestampHeader]: timestamp,
        },
      }),
    );
    expect(result.ok).toBe(true);
  });
});
