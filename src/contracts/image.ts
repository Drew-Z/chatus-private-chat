export const IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

export type ImageInputPolicy = {
  acceptedMediaTypes: ImageMediaType[];
  maxImages: number;
  maxImageBytes: number;
  maxTotalImageBytes: number;
};

export type ImageValidationErrorCode =
  | "invalid_image_type"
  | "invalid_image_data"
  | "image_too_large"
  | "too_many_images"
  | "images_too_large";

export type ParsedDataImage = {
  mediaType: ImageMediaType;
  data: string;
  decodedBytes: number;
};

export type DataImageParseResult =
  | { ok: true; image: ParsedDataImage }
  | { ok: false; error: "invalid_image_type" | "invalid_image_data" };

// AIChat stores one UI message per SQLite row. Keep the Base64-expanded user
// message comfortably below the SDK's 1.8 MB row-safety threshold.
export const MAX_INLINE_IMAGE_BYTES_PER_MESSAGE = 1_300_000;

export const DEFAULT_IMAGE_INPUT_POLICY: Readonly<ImageInputPolicy> = {
  acceptedMediaTypes: [...IMAGE_MEDIA_TYPES],
  maxImages: 4,
  maxImageBytes: MAX_INLINE_IMAGE_BYTES_PER_MESSAGE,
  maxTotalImageBytes: MAX_INLINE_IMAGE_BYTES_PER_MESSAGE,
};

export function normalizeImageMediaType(value: unknown): ImageMediaType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() === "image/jpg"
    ? "image/jpeg"
    : value.trim().toLowerCase();
  return IMAGE_MEDIA_TYPES.includes(normalized as ImageMediaType)
    ? normalized as ImageMediaType
    : null;
}

export function parseDataImage(value: unknown, declaredMediaType?: unknown): DataImageParseResult {
  if (typeof value !== "string") return { ok: false, error: "invalid_image_data" };
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(value);
  if (!match) return { ok: false, error: "invalid_image_data" };

  const mediaType = normalizeImageMediaType(match[1]);
  if (!mediaType) return { ok: false, error: "invalid_image_type" };
  if (declaredMediaType !== undefined) {
    const declared = normalizeImageMediaType(declaredMediaType);
    if (!declared) return { ok: false, error: "invalid_image_type" };
    if (declared !== mediaType) return { ok: false, error: "invalid_image_data" };
  }

  const data = match[2];
  if (!isStrictBase64(data)) return { ok: false, error: "invalid_image_data" };
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return {
    ok: true,
    image: {
      mediaType,
      data,
      decodedBytes: (data.length / 4) * 3 - padding,
    },
  };
}

function isStrictBase64(value: string): boolean {
  return value.length > 0
    && value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}
