import { downloadPhoto, PhotoDownloadError } from './photo-download';

const asset = { id: '42', url: '/photos/42.jpg', title: 'Sunset Landscape' };
const fetchMock = jest.fn();
const createObjectURL = jest.fn();
const revokeObjectURL = jest.fn();
const clickedAnchor = jest.fn();
const originalFetch = globalThis.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function response({
  ok = true,
  type = 'image/jpeg',
  body = 'image data',
  disposition = '',
  url = 'http://localhost/photos/42.jpg',
} = {}): Response {
  return {
    ok,
    url,
    headers: new Headers({ 'Content-Disposition': disposition }),
    blob: jest.fn().mockResolvedValue(new Blob([body], { type })),
  } as unknown as Response;
}

describe('downloadPhoto', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    globalThis.fetch = fetchMock;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    createObjectURL.mockReturnValue('blob:photo');
    fetchMock.mockResolvedValue(response());
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedAnchor(this);
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.resetAllMocks();
    globalThis.fetch = originalFetch;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
  });

  it('fetches the asset and triggers a download with a metadata filename', async () => {
    await expect(downloadPhoto(asset)).resolves.toEqual({ filename: 'Sunset-Landscape.jpg' });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost/photos/42.jpg', {
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
    });
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickedAnchor).toHaveBeenCalledWith(expect.objectContaining({
      download: 'Sunset-Landscape.jpg',
      href: 'blob:photo',
    }));
    expect(document.querySelector('a')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });

  it('reports an HTTP failure without creating an object URL', async () => {
    fetchMock.mockResolvedValue(response({ ok: false }));
    await expect(downloadPhoto(asset)).rejects.toMatchObject({
      code: 'HTTP',
      message: 'This photo could not be downloaded. Please try again.',
    });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('reports a network failure without leaking the original error', async () => {
    fetchMock.mockRejectedValue(new Error('sensitive response'));
    await expect(downloadPhoto(asset)).rejects.toEqual(new PhotoDownloadError('NETWORK'));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('handles a failure while reading the response body', async () => {
    const broken = response();
    jest.mocked(broken.blob).mockRejectedValue(new Error('connection reset'));
    fetchMock.mockResolvedValue(broken);
    await expect(downloadPhoto(asset)).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it.each([
    { type: 'text/html', body: '<html>Error</html>' },
    { type: 'application/json', body: '{}' },
    { type: 'image/jpeg', body: '' },
    { type: '', body: 'unknown' },
    { type: 'constructor', body: 'invalid' },
  ])('rejects invalid payloads: %j', async (payload) => {
    fetchMock.mockResolvedValue(response(payload));
    await expect(downloadPhoto(asset)).rejects.toMatchObject({ code: 'INVALID_ASSET' });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it.each(['', 'javascript:alert(1)', 'data:image/png;base64,abc', 'https://[invalid'])(
    'rejects invalid asset URLs before fetching: %s',
    async (url) => {
      await expect(downloadPhoto({ ...asset, url })).rejects.toMatchObject({ code: 'INVALID_ASSET' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['attachment; filename="original.jpg"', 'original.jpg'],
    ['attachment; filename="../../unsafe:name.exe"', 'unsafe-name.jpg'],
    ['attachment; filename="CON.jpg"', '_CON.jpg'],
    ['attachment; filename="plain.jpg"; filename*=UTF-8\'\'preferred%20name.jpg', 'preferred-name.jpg'],
    ['attachment; filename="plain.jpg"; filename*=UTF-8\'\'bad%XX', 'plain.jpg'],
    ['attachment; filename="a;b.jpg"', 'a-b.jpg'],
  ])('honors and sanitizes a trusted filename: %s', async (disposition, filename) => {
    fetchMock.mockResolvedValue(response({ disposition }));
    await expect(downloadPhoto(asset)).resolves.toEqual({ filename });
  });

  it('ignores a filename supplied by an external response, including redirects', async () => {
    fetchMock.mockResolvedValue(response({
      url: 'https://images.example.test/photo?signature=private',
      disposition: 'attachment; filename="untrusted.jpg"',
    }));
    await expect(downloadPhoto({ ...asset, filename: 'metadata.jpg' }))
      .resolves.toEqual({ filename: 'metadata.jpg' });
  });

  it('falls back deterministically when metadata is missing', async () => {
    await expect(downloadPhoto({ id: '42', url: asset.url }))
      .resolves.toEqual({ filename: 'photo-42.jpg' });
  });

  it('falls back when metadata sanitizes to an empty name', async () => {
    await expect(downloadPhoto({ ...asset, title: '../' }))
      .resolves.toEqual({ filename: 'photo-42.jpg' });
  });

  it('uses the payload MIME type for the extension', async () => {
    fetchMock.mockResolvedValue(response({ type: 'image/png' }));
    await expect(downloadPhoto({ ...asset, filename: 'original.exe' }))
      .resolves.toEqual({ filename: 'original.png' });
  });

  it('cleans up the anchor and object URL even if triggering the browser fails', async () => {
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('browser failure');
    });
    await expect(downloadPhoto(asset)).rejects.toMatchObject({ code: 'BROWSER' });
    expect(document.querySelector('a')).toBeNull();
    jest.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });
});
