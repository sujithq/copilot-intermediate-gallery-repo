export interface DownloadAsset {
  id: string;
  url: string;
  title?: string;
  filename?: string;
}

export interface DownloadResult {
  filename: string;
}

export type PhotoDownloadService = (asset: DownloadAsset) => Promise<DownloadResult>;
export type DownloadErrorCode = 'NETWORK' | 'HTTP' | 'INVALID_ASSET' | 'BROWSER';

const errorMessages: Record<DownloadErrorCode, string> = {
  NETWORK: 'Unable to connect. Check your connection and try again.',
  HTTP: 'This photo could not be downloaded. Please try again.',
  INVALID_ASSET: 'This photo is not available as a valid image. Please try again.',
  BROWSER: 'The download could not be started. Please try again.',
};

export class PhotoDownloadError extends Error {
  constructor(public readonly code: DownloadErrorCode) {
    super(errorMessages[code]);
    this.name = 'PhotoDownloadError';
  }
}

const imageExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/tiff': 'tif',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

function dispositionFilename(value: string | null): string | undefined {
  if (!value) return;
  const encoded = /(?:^|;)\s*filename\*\s*=\s*UTF-8'[^']*'([^;]+)/i.exec(value);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // Fall back to the plain filename if the encoded value is malformed.
    }
  }
  const plain = /(?:^|;)\s*filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]+))/i.exec(value);
  return plain?.[1]?.replace(/\\(.)/g, '$1') ?? plain?.[2]?.trim();
}

function safeStem(value: string): string {
  return (value.split(/[/\\]/).pop() ?? '')
    .normalize('NFKC')
    .replace(/\.[^.]*$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 100);
}

function downloadFilename(asset: DownloadAsset, header: string | undefined, extension: string): string {
  const fallback = `photo-${safeStem(asset.id) || 'download'}`;
  let stem = safeStem(header || asset.filename || asset.title || '') || fallback;
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  return `${stem}.${extension}`;
}

export const downloadPhoto: PhotoDownloadService = async (asset) => {
  let assetUrl: URL;
  try {
    assetUrl = new URL(asset.url, window.location.href);
    if (!asset.url.trim() || !['http:', 'https:'].includes(assetUrl.protocol) ||
        assetUrl.username || assetUrl.password) {
      throw new Error();
    }
  } catch {
    throw new PhotoDownloadError('INVALID_ASSET');
  }

  let response: Response;
  try {
    response = await fetch(assetUrl.href, {
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new PhotoDownloadError('NETWORK');
  }
  if (!response.ok) throw new PhotoDownloadError('HTTP');

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    throw new PhotoDownloadError('NETWORK');
  }
  const mimeType = blob.type.toLowerCase().split(';')[0];
  const extension = Object.hasOwn(imageExtensions, mimeType) ? imageExtensions[mimeType] : undefined;
  if (!blob.size || !extension) throw new PhotoDownloadError('INVALID_ASSET');

  // Only same-origin response metadata is trusted; external adapters can supply a filename.
  const responseUrl = new URL(response.url || assetUrl.href, window.location.href);
  const trustedHeader = responseUrl.origin === window.location.origin
    ? dispositionFilename(response.headers.get('Content-Disposition'))
    : undefined;
  const filename = downloadFilename(asset, trustedHeader, extension);

  try {
    const anchor = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    try {
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
    } finally {
      anchor.remove();
      // Allow the browser to consume the URL before releasing it.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  } catch {
    throw new PhotoDownloadError('BROWSER');
  }
  return { filename };
};
