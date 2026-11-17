import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GalleryGrid } from './GalleryGrid';
import { usePhotoDownload } from '@/hooks/usePhotoDownload';
import { mockPhotos } from '@/lib/mock-photo-data';
import { PhotoDownloadError, photoDownloadService, type PhotoDownloadResult } from '@/lib/photo-download';

jest.mock('@/lib/photo-download', () => ({
  ...jest.requireActual('@/lib/photo-download'),
  photoDownloadService: { download: jest.fn() },
}));

const downloadMock = jest.mocked(photoDownloadService.download);

function pendingDownload() {
  let resolve!: (value: PhotoDownloadResult) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<PhotoDownloadResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function cardFor(title: string): HTMLElement {
  const card = screen.getByRole('heading', { name: title }).closest('.card-elevated');
  if (!(card instanceof HTMLElement)) throw new Error('Expected photo card');
  return card;
}

describe('GalleryGrid downloads', () => {
  beforeEach(() => {
    downloadMock.mockImplementation(async photo => ({
      photoId: photo.id,
      filename: `${photo.id}.png`,
    }));
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should disable only the active photo, prevent duplicates, and reset after handoff', async () => {
    const user = userEvent.setup();
    const pending = pendingDownload();
    downloadMock.mockReturnValueOnce(pending.promise);
    render(<GalleryGrid limit={2} />);
    const first = screen.getByRole('button', { name: 'Download Sunset Landscape' });
    const second = screen.getByRole('button', { name: 'Download Portrait Study' });
    const card = within(cardFor('Sunset Landscape'));

    await user.click(first);
    expect(first).toBeDisabled();
    expect(first).toHaveAttribute('aria-busy', 'true');
    expect(first.querySelector('svg')).toHaveClass('h-4', 'w-4', 'animate-spin');
    expect(card.getByRole('status')).toHaveTextContent('Downloading Sunset Landscape.');
    expect(second).toBeEnabled();
    await user.click(first);
    expect(downloadMock).toHaveBeenCalledTimes(1);
    expect(downloadMock).toHaveBeenCalledWith(mockPhotos[0], expect.any(AbortSignal));

    await act(async () => pending.resolve({ photoId: '1', filename: 'sunset.png' }));
    expect(first).toBeEnabled();
    expect(first).toHaveAttribute('aria-busy', 'false');
    expect(first.querySelector('svg')).not.toHaveClass('animate-spin');
    expect(card.getByRole('status')).toHaveTextContent('Download started for Sunset Landscape.');
  });

  it('should allow different photos to download concurrently without mixing their state', async () => {
    const user = userEvent.setup();
    const firstRequest = pendingDownload();
    const secondRequest = pendingDownload();
    downloadMock.mockReturnValueOnce(firstRequest.promise).mockReturnValueOnce(secondRequest.promise);
    render(<GalleryGrid limit={2} />);
    const first = screen.getByRole('button', { name: 'Download Sunset Landscape' });
    const second = screen.getByRole('button', { name: 'Download Portrait Study' });
    await user.click(first);
    await user.click(second);
    expect(downloadMock).toHaveBeenCalledTimes(2);
    expect(first).toBeDisabled();
    expect(second).toBeDisabled();

    await act(async () => secondRequest.resolve({ photoId: '2', filename: 'portrait.png' }));
    expect(first).toBeDisabled();
    expect(second).toBeEnabled();
    await act(async () => firstRequest.resolve({ photoId: '1', filename: 'sunset.png' }));
    expect(first).toBeEnabled();
  });

  it('should show an accessible error, restore the action, and allow retry', async () => {
    const user = userEvent.setup();
    downloadMock.mockRejectedValueOnce(new PhotoDownloadError('network'));
    render(<GalleryGrid limit={1} />);
    const button = screen.getByRole('button', { name: 'Download Sunset Landscape' });
    await user.click(button);
    const error = await screen.findByRole('alert');
    expect(error).toBeVisible();
    expect(error).toHaveTextContent('Check your connection and try again.');
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleDescription(error.textContent ?? '');

    const retry = pendingDownload();
    downloadMock.mockReturnValueOnce(retry.promise);
    await user.click(button);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(button).toBeDisabled();
    await act(async () => retry.resolve({ photoId: '1', filename: 'sunset.png' }));
    expect(button).toBeEnabled();
    expect(downloadMock).toHaveBeenCalledTimes(2);
  });

  it('should not expose an unexpected adapter error to the user', async () => {
    const user = userEvent.setup();
    downloadMock.mockRejectedValue(new Error('https://private.invalid/photo?token=sensitive'));
    render(<GalleryGrid limit={1} />);
    await user.click(screen.getByRole('button', { name: 'Download Sunset Landscape' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(new PhotoDownloadError('browser').message);
    expect(screen.queryByText(/token=sensitive/)).not.toBeInTheDocument();
  });

  it.each(['{Enter}', ' '])('should support keyboard activation with %s and announce status', async key => {
    const user = userEvent.setup();
    const pending = pendingDownload();
    downloadMock.mockReturnValue(pending.promise);
    render(<GalleryGrid limit={1} />);
    const button = screen.getByRole('button', { name: 'Download Sunset Landscape' });
    await user.tab();
    await user.tab();
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard(key);
    expect(downloadMock).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveTextContent('Downloading Sunset Landscape.');
    await act(async () => pending.resolve({ photoId: '1', filename: 'sunset.png' }));
  });

  it('should retain the pending photo state across filters and pagination', async () => {
    const user = userEvent.setup();
    const pending = pendingDownload();
    downloadMock.mockReturnValue(pending.promise);
    const { rerender } = render(<GalleryGrid limit={1} />);
    await user.click(screen.getByRole('button', { name: 'Download Sunset Landscape' }));
    rerender(<GalleryGrid limit={1} searchQuery="Portrait" />);
    expect(screen.queryByRole('button', { name: 'Download Sunset Landscape' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Portrait Study' })).toBeEnabled();
    rerender(<GalleryGrid limit={1} currentPage={2} />);
    expect(screen.getByRole('button', { name: 'Download Sunset Landscape' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download Portrait Study' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Download Sunset Landscape' }));
    expect(downloadMock).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ photoId: '1', filename: 'sunset.png' }));
  });

  it('should cancel pending requests when the grid unmounts', async () => {
    const user = userEvent.setup();
    const pending = pendingDownload();
    downloadMock.mockReturnValue(pending.promise);
    const { unmount } = render(<GalleryGrid limit={1} />);
    await user.click(screen.getByRole('button', { name: 'Download Sunset Landscape' }));
    const signal = downloadMock.mock.calls[0][1];
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.reject(new PhotoDownloadError('aborted')));
  });

  it('should guard synchronous duplicate calls before React rerenders', async () => {
    const pending = pendingDownload();
    downloadMock.mockReturnValue(pending.promise);
    const { result } = renderHook(() => usePhotoDownload());
    act(() => {
      void result.current.download(mockPhotos[0]);
      void result.current.download(mockPhotos[0]);
    });
    expect(downloadMock).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ photoId: '1', filename: 'sunset.png' }));
    expect(result.current.states['1'].status).toBe('idle');
  });

  it('should keep likes, details, tag filters, and load-more usable during a download', async () => {
    const user = userEvent.setup();
    const pending = pendingDownload();
    downloadMock.mockReturnValue(pending.promise);
    const onLoadMore = jest.fn();
    const { rerender } = render(<GalleryGrid limit={1} onLoadMore={onLoadMore} />);
    const card = within(cardFor('Sunset Landscape'));
    await user.click(card.getByRole('button', { name: 'Download Sunset Landscape' }));
    const like = card.getAllByRole('button')[1];
    await user.click(like);
    expect(card.getByText('125')).toBeInTheDocument();
    await user.click(card.getByRole('button', { name: 'View Details' }));
    expect(screen.getByRole('heading', { name: 'Sunset Landscape', level: 2 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '\u2715' }));
    await user.click(screen.getByRole('button', { name: 'Load More Photos' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    rerender(<GalleryGrid limit={1} selectedTags={['portrait']} />);
    expect(screen.getByRole('heading', { name: 'Portrait Study' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sunset Landscape' })).not.toBeInTheDocument();
    await act(async () => pending.resolve({ photoId: '1', filename: 'sunset.png' }));
  });
});
