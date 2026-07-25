import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_IMAGE_INPUT_POLICY,
  parseDataImage,
} from "../src/contracts/image";
import {
  addDraftImageFiles,
  readDraftImage,
  releaseImagePreviews,
  restoreRejectedImages,
  toImageFileParts,
} from "../client/src/lib/image-input";
import { imageInputPolicy, normalizeMessages, type Env } from "../src/worker";
import { sanitizeUserImageParts } from "../src/agent/team-agent";

const policy = {
  ...DEFAULT_IMAGE_INPUT_POLICY,
  acceptedMediaTypes: [...DEFAULT_IMAGE_INPUT_POLICY.acceptedMediaTypes],
};

describe("image input contract", () => {
  it("allows environment overrides to lower but never raise inline ceilings", () => {
    expect(imageInputPolicy({
      MAX_IMAGES_PER_REQUEST: "99",
      MAX_IMAGE_BYTES: "9999999",
      MAX_TOTAL_IMAGE_BYTES: "9999999",
    } as Env)).toEqual(policy);
    expect(imageInputPolicy({
      MAX_IMAGES_PER_REQUEST: "2",
      MAX_IMAGE_BYTES: "1000",
      MAX_TOTAL_IMAGE_BYTES: "1500",
    } as Env)).toMatchObject({
      maxImages: 2,
      maxImageBytes: 1000,
      maxTotalImageBytes: 1500,
    });
  });

  it("parses strict padded base64 and reports exact decoded bytes", () => {
    expect(parseDataImage("data:image/png;base64,QQ==")).toEqual({
      ok: true,
      image: { mediaType: "image/png", data: "QQ==", decodedBytes: 1 },
    });
    expect(parseDataImage("data:image/jpg;base64,QUI=", "image/jpeg")).toEqual({
      ok: true,
      image: { mediaType: "image/jpeg", data: "QUI=", decodedBytes: 2 },
    });
    expect(parseDataImage("data:image/png;base64,QUJD")).toMatchObject({
      ok: true,
      image: { decodedBytes: 3 },
    });
  });

  it.each([
    ["remote URL", "https://example.test/image.png", undefined, "invalid_image_data"],
    ["empty data", "data:image/png;base64,", undefined, "invalid_image_data"],
    ["invalid padding", "data:image/png;base64,QU=J", undefined, "invalid_image_data"],
    ["unsupported MIME", "data:image/svg+xml;base64,PHN2Zz4=", undefined, "invalid_image_type"],
    ["declared MIME mismatch", "data:image/png;base64,QQ==", "image/jpeg", "invalid_image_data"],
  ])("rejects %s", (_label, value, mediaType, error) => {
    expect(parseDataImage(value, mediaType)).toEqual({ ok: false, error });
  });

  it("returns exact normalization errors without partially keeping image batches", () => {
    const env = {
      MAX_IMAGES_PER_REQUEST: "1",
      MAX_IMAGE_BYTES: "2",
      MAX_TOTAL_IMAGE_BYTES: "2",
    } as Env;
    const content = (urls: string[]) => [{
      role: "user",
      content: urls.map((url) => ({ type: "image_url", image_url: { url } })),
    }];

    expect(normalizeMessages(content(["https://example.test/image.png"]), env)).toMatchObject({
      ok: false,
      error: "invalid_image_data",
      status: 400,
    });
    expect(normalizeMessages(content(["data:image/png;base64,QUJD"]), env)).toMatchObject({
      ok: false,
      error: "image_too_large",
      status: 413,
    });
    expect(normalizeMessages(content([
      "data:image/png;base64,QQ==",
      "data:image/png;base64,QQ==",
    ]), env)).toMatchObject({ ok: false, error: "too_many_images" });
    expect(normalizeMessages(content([
      "data:image/png;base64,QQ==",
      "data:image/png;base64,QQ==",
    ]), { ...env, MAX_IMAGES_PER_REQUEST: "2", MAX_TOTAL_IMAGE_BYTES: "1" } as Env))
      .toMatchObject({ ok: false, error: "images_too_large", status: 413 });

    expect(normalizeMessages([
      ...content(["data:image/png;base64,QQ=="]),
      ...content(["data:image/png;base64,QQ=="]),
    ], { ...env, MAX_TOTAL_IMAGE_BYTES: "1" } as Env)).toMatchObject({
      ok: true,
      messages: [{ role: "user" }, { role: "user" }],
    });
  });

  it("strips every user file part when a forged attachment fails persistence validation", () => {
    const result = sanitizeUserImageParts([
      { type: "text", text: "keep the bounded text" },
      { type: "file", mediaType: "image/png", filename: "remote.png", url: "https://example.test/image.png" },
      { type: "file", mediaType: "image/png", filename: "valid.png", url: "data:image/png;base64,QQ==" },
    ], policy);
    expect(result.error).toBe("invalid_image_data");
    expect(result.parts).toEqual([{ type: "text", text: "keep the bounded text" }]);
  });
});

describe("image draft lifecycle", () => {
  it("keeps deterministic reading and per-file error states", () => {
    const ids = ["one", "two", "three"];
    const files = [
      new File([new Uint8Array([65])], "one.png", { type: "image/png" }),
      new File([new Uint8Array([65])], "two.svg", { type: "image/svg+xml" }),
      new File([new Uint8Array([65, 66, 67])], "large.png", { type: "image/png" }),
    ];
    const next = addDraftImageFiles([], files, { ...policy, maxImageBytes: 2 }, {
      createId: () => ids.shift() || "missing",
      createObjectURL: (file) => `blob:${file.name}`,
    });

    expect(next.map(({ id, status, error, previewUrl }) => ({ id, status, error, previewUrl }))).toEqual([
      { id: "one", status: "reading", error: undefined, previewUrl: "blob:one.png" },
      { id: "two", status: "error", error: "unsupported_type", previewUrl: "" },
      { id: "three", status: "error", error: "too_large", previewUrl: "" },
    ]);
  });

  it("reads a ready attachment, creates AI SDK parts, and restores a rejected batch", async () => {
    const [reading] = addDraftImageFiles(
      [],
      [new File([new Uint8Array([65])], "one.png", { type: "image/png" })],
      policy,
      { createId: () => "one", createObjectURL: () => "blob:one" },
    );
    const ready = await readDraftImage(reading, async () => "data:image/png;base64,QQ==");
    expect(ready.status).toBe("ready");
    expect(toImageFileParts([ready])).toEqual([{
      type: "file",
      mediaType: "image/png",
      filename: "one.png",
      url: "data:image/png;base64,QQ==",
    }]);
    expect(restoreRejectedImages([], [ready])).toEqual([ready]);
    expect(restoreRejectedImages([reading], [ready])).toEqual([reading]);
  });

  it("marks corrupt reads and releases each preview once", async () => {
    const [reading] = addDraftImageFiles(
      [],
      [new File([new Uint8Array([65])], "one.png", { type: "image/png" })],
      policy,
      { createId: () => "one", createObjectURL: () => "blob:one" },
    );
    await expect(readDraftImage(reading, async () => "data:image/png;base64,QUI=")).resolves.toMatchObject({
      status: "error",
      error: "read_failed",
    });
    const revoke = vi.fn();
    releaseImagePreviews([reading, { ...reading }], revoke);
    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:one");
  });
});
