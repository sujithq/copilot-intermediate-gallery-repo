export interface PhotoDownloadRequest {
  id: string;
  title: string;
  url: string;
}

export interface PhotoDownloadResult {
  photoId: string;
  filename: string;
}

export interface PhotoDownloadService {
  download(photo: PhotoDownloadRequest, signal?: AbortSignal): Promise<PhotoDownloadResult>;
}

export type PhotoDownloadErrorCode = 'network' | 'http' | 'invalid-payload' | 'browser' | 'aborted';

// Even four-byte UTF-8 characters leave room for the extension below 255 bytes.
const maxFilenameStemLength = 60;

const errorMessages: Record<PhotoDownloadErrorCode, string> = {
  network: 'Could not retrieve the photo. Check your connection and try again.',
  http: 'The photo is unavailable right now. Please try again.',
  'invalid-payload': 'The response was not a supported photo. Please try again.',
  browser: 'The browser could not start the download. Please try again.',
  aborted: 'The download was cancelled.',
};

export class PhotoDownloadError extends Error {
  constructor(public readonly code: PhotoDownloadErrorCode) {
    super(errorMessages[code]);
    this.name = 'PhotoDownloadError';
  }
}

function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PhotoDownloadError('aborted');
  }
}

function imageExtension(bytes: Uint8Array, mimeType: string): string {
  const startsWith = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  const textAt = (offset: number, text: string) =>
    [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));

  if (mimeType === 'image/png' && startsWith(137, 80, 78, 71, 13, 10, 26, 10)) return 'png';
  if (mimeType === 'image/jpeg' && startsWith(255, 216, 255)) return 'jpg';
  if (mimeType === 'image/gif' && (textAt(0, 'GIF87a') || textAt(0, 'GIF89a'))) return 'gif';
  if (mimeType === 'image/webp' && textAt(0, 'RIFF') && textAt(8, 'WEBP')) return 'webp';
  throw new PhotoDownloadError('invalid-payload');
}

function dispositionFilename(header: string | null): string | undefined {
  if (!header) return undefined;
  const parameters = new Map<string, string>();
  const pattern = /;\s*(filename\*?)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s"]+))\s*(?=;|$)/gi;
  for (const match of header.matchAll(pattern)) {
    const key = match[1].toLowerCase();
    // Duplicate filename parameters are ambiguous; use photo metadata instead.
    if (parameters.has(key)) return undefined;
    parameters.set(key, match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : match[3]);
  }

  const extended = parameters.get('filename*')?.match(/^UTF-8'[^']*'(.*)$/i);
  if (extended) {
    try {
      return decodeURIComponent(extended[1]);
    } catch {
      // Malformed extended metadata can still have a valid legacy filename.
    }
  }
  return parameters.get('filename');
}

function safeStem(value: string): string {
  const basename = value.split(/[/\\]/).pop() ?? '';
  const stem = basename
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '')
    .replace(/^\.+/, '')
    .replace(/\.[^.]+$/, '')
    .trim()
    .replace(/\s+/g, '-');
  const bounded = [...stem].slice(0, maxFilenameStemLength).join('').replace(/[. -]+$/g, '');
  if (!bounded || /^[.-]+$/.test(bounded)) return '';
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(bounded) ? `_${bounded}` : bounded;
}

function downloadFilename(photo: PhotoDownloadRequest, response: Response, extension: string): string {
  // Only same-origin final responses supply trusted header metadata in this adapter.
  const trusted = response.url !== '' && new URL(response.url).origin === window.location.origin;
  const headerName = trusted ? dispositionFilename(response.headers.get('Content-Disposition')) : undefined;
  const id = safeStem(photo.id) || 'unknown';
  const title = safeStem(photo.title);
  const fallback = title ? `${title}-${id}` : `photo-${id}`;
  const stem = (headerName && safeStem(headerName)) || fallback;
  return `${[...stem].slice(0, maxFilenameStemLength).join('').replace(/[. ]+$/g, '')}.${extension}`;
}

async function download(photo: PhotoDownloadRequest, signal?: AbortSignal): Promise<PhotoDownloadResult> {
  checkCancellation(signal);
  let response: Response;
  let blob: Blob;
  let bytes: Uint8Array;
  try {
    response = await fetch(photo.url, { signal, credentials: 'same-origin', referrerPolicy: 'no-referrer' });
    checkCancellation(signal);
    if (!response.ok) throw new PhotoDownloadError('http');
    blob = await response.blob();
    bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  } catch (error) {
    checkCancellation(signal);
    if (error instanceof PhotoDownloadError) throw error;
    throw new PhotoDownloadError('network');
  }

  checkCancellation(signal);
  if (blob.size < 12) throw new PhotoDownloadError('invalid-payload');
  const extension = imageExtension(bytes, blob.type.toLowerCase().split(';')[0].trim());
  if (typeof createImageBitmap !== 'function') throw new PhotoDownloadError('browser');
  try {
    const image = await createImageBitmap(blob);
    image.close();
  } catch {
    checkCancellation(signal);
    throw new PhotoDownloadError('invalid-payload');
  }
  checkCancellation(signal);
  const filename = downloadFilename(photo, response, extension);

  let objectUrl: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  let handedOff = false;
  try {
    objectUrl = URL.createObjectURL(blob);
    anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    handedOff = true;
    return { photoId: photo.id, filename };
  } catch {
    throw new PhotoDownloadError('browser');
  } finally {
    anchor?.remove();
    if (objectUrl) {
      const url = objectUrl;
      if (handedOff) {
        // Let the browser consume the URL before releasing its backing blob.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        URL.revokeObjectURL(url);
      }
    }
  }
}

export const photoDownloadService: PhotoDownloadService = { download };
