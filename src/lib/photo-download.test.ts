import { Blob as NodeBlob } from 'node:buffer';
import { photoDownloadService, PhotoDownloadError } from './photo-download';

const photo = { id: '1', title: 'Sunset Landscape', url: '/photos/photo-1.png' };
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5t0AAAAASUVORK5CYII=',
  'base64',
);

function imageResponse({
  bytes = png,
  type = 'image/png',
  status = 200,
  url = 'http://localhost/photos/photo-1.png',
  disposition,
}: {
  bytes?: Uint8Array;
  type?: string;
  status?: number;
  url?: string;
  disposition?: string;
} = {}) {
  const headers = new Headers({ 'Content-Type': type });
  if (disposition) headers.set('Content-Disposition', disposition);
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers,
    blob: jest.fn().mockResolvedValue(new NodeBlob([bytes], { type })),
  };
}

describe('photoDownloadService', () => {
  const fetchMock = jest.fn();
  const createObjectURL = jest.fn();
  const revokeObjectURL = jest.fn();
  const decodeImage = jest.fn();
  const closeImage = jest.fn();
  const globals = [
    { target: globalThis, key: 'fetch', value: fetchMock },
    { target: globalThis, key: 'createImageBitmap', value: decodeImage },
    { target: URL, key: 'createObjectURL', value: createObjectURL },
    { target: URL, key: 'revokeObjectURL', value: revokeObjectURL },
  ].map(entry => ({ ...entry, original: Object.getOwnPropertyDescriptor(entry.target, entry.key) }));

  beforeEach(() => {
    jest.useFakeTimers();
    globals.forEach(({ target, key, value }) =>
      Object.defineProperty(target, key, { configurable: true, writable: true, value }),
    );
    fetchMock.mockResolvedValue(imageResponse());
    decodeImage.mockResolvedValue({ close: closeImage });
    createObjectURL.mockReturnValue('blob:download');
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.resetAllMocks();
    globals.forEach(({ target, key, original }) => {
      if (original) Object.defineProperty(target, key, original);
      else Reflect.deleteProperty(target, key);
    });
  });

  it('should fetch the requested asset, hand it to the browser, and release browser resources', async () => {
    const controller = new AbortController();
    const response = imageResponse();
    fetchMock.mockResolvedValue(response);
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this).toBeInTheDocument();
      expect(this.download).toBe('Sunset-Landscape-1.png');
      expect(this.href).toBe('blob:download');
    });

    await expect(photoDownloadService.download(photo, controller.signal)).resolves.toEqual({
      photoId: '1',
      filename: 'Sunset-Landscape-1.png',
    });
    expect(fetchMock).toHaveBeenCalledWith(photo.url, {
      signal: controller.signal,
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
    });
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).not.toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledWith(await response.blob());
    expect(closeImage).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });

  it.each([404, 403, 500])('should return a safe HTTP error for status %s', async status => {
    const response = imageResponse({ status });
    fetchMock.mockResolvedValue(response);
    await expect(photoDownloadService.download(photo)).rejects.toMatchObject({
      code: 'http',
      message: 'The photo is unavailable right now. Please try again.',
    });
    expect(response.blob).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('should normalize network errors without exposing sensitive error text', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch https://example.invalid/?token=private'));
    await expect(photoDownloadService.download(photo)).rejects.toEqual(new PhotoDownloadError('network'));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('should normalize body-read failures as recoverable network errors', async () => {
    const response = imageResponse();
    response.blob.mockRejectedValue(new Error('Connection interrupted'));
    fetchMock.mockResolvedValue(response);
    await expect(photoDownloadService.download(photo)).rejects.toMatchObject({ code: 'network' });
  });

  it.each([
    ['empty', new Uint8Array(), 'image/png'],
    ['HTML', Buffer.from('<html>Not a photo</html>'), 'text/html'],
    ['disguised HTML', Buffer.from('<html>Not a photo</html>'), 'image/png'],
    ['mismatched type', png, 'image/jpeg'],
    ['unsupported SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml'],
  ])('should reject %s payloads before creating an object URL', async (_label, bytes, type) => {
    fetchMock.mockResolvedValue(imageResponse({ bytes, type }));
    await expect(photoDownloadService.download(photo)).rejects.toMatchObject({ code: 'invalid-payload' });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('should reject corrupt image data even when the signature and MIME match', async () => {
    decodeImage.mockRejectedValue(new DOMException('The source image could not be decoded'));
    await expect(photoDownloadService.download(photo)).rejects.toMatchObject({ code: 'invalid-payload' });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it.each([
    ['attachment; filename="Original shot.png"', 'Original-shot.png'],
    ["attachment; filename=\"fallback.png\"; filename*=UTF-8''Caf%C3%A9%20photo.png", 'Caf\u00e9-photo.png'],
    ['attachment; filename="../../CON.exe"', '_CON.png'],
    ['attachment; filename="report?.exe"', 'report.png'],
    ['attachment; filename="..."', 'Sunset-Landscape-1.png'],
    ["attachment; filename*=UTF-8''bad%ZZ.png", 'Sunset-Landscape-1.png'],
    ['attachment; filename="one.png"; filename="two.png"', 'Sunset-Landscape-1.png'],
    ['attachment; filename="unterminated', 'Sunset-Landscape-1.png'],
  ])('should choose a safe filename for %s', async (disposition, filename) => {
    fetchMock.mockResolvedValue(imageResponse({ disposition }));
    await expect(photoDownloadService.download(photo)).resolves.toMatchObject({ filename });
  });

  it('should use a deterministic ID fallback when title and filename metadata are unusable', async () => {
    await expect(photoDownloadService.download({ ...photo, title: '../...' })).resolves.toMatchObject({
      filename: 'photo-1.png',
    });
  });

  it('should bound long filenames and preserve the validated image extension', async () => {
    fetchMock.mockResolvedValue(imageResponse({ disposition: `attachment; filename="${'x'.repeat(300)}.exe"` }));
    const result = await photoDownloadService.download(photo);
    expect(Buffer.byteLength(result.filename, 'utf8')).toBeLessThanOrEqual(255);
    expect(result.filename).toMatch(/^x+\.png$/);
  });

  it('should keep multibyte filenames within filesystem byte limits', async () => {
    const name = '\u{1f4f7}'.repeat(100);
    fetchMock.mockResolvedValue(imageResponse({
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}.png`,
    }));
    const result = await photoDownloadService.download(photo);
    expect(Buffer.byteLength(result.filename, 'utf8')).toBeLessThanOrEqual(255);
    expect(result.filename).toMatch(/\.png$/);
  });

  it('should ignore Content-Disposition on an untrusted redirected response', async () => {
    fetchMock.mockResolvedValue(imageResponse({
      url: 'https://other.invalid/photo.png',
      disposition: 'attachment; filename="untrusted.png"',
    }));
    await expect(photoDownloadService.download(photo)).resolves.toMatchObject({
      filename: 'Sunset-Landscape-1.png',
    });
  });

  it('should immediately clean up the anchor and object URL when browser handoff fails', async () => {
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('Browser blocked download');
    });
    await expect(photoDownloadService.download(photo)).rejects.toMatchObject({ code: 'browser' });
    expect(document.querySelector('a[download]')).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });

  it('should report object-URL creation failure without claiming success', async () => {
    createObjectURL.mockImplementation(() => { throw new Error('Unavailable'); });
    await expect(photoDownloadService.download(photo)).rejects.toMatchObject({ code: 'browser' });
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it('should stop an already-cancelled download before fetching', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(photoDownloadService.download(photo, controller.signal)).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should stop browser handoff if cancelled during image decoding and close the bitmap', async () => {
    const controller = new AbortController();
    decodeImage.mockImplementation(async () => {
      controller.abort();
      return { close: closeImage };
    });
    await expect(photoDownloadService.download(photo, controller.signal)).rejects.toMatchObject({ code: 'aborted' });
    expect(closeImage).toHaveBeenCalledTimes(1);
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
