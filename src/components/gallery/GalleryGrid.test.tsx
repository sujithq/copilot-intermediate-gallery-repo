import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GalleryGrid } from './GalleryGrid';
import { mockPhotos } from '@/lib/mock-photo-data';
import { DownloadResult, PhotoDownloadError, PhotoDownloadService } from '@/lib/photo-download';

function deferredDownload() {
  let resolve!: (value: DownloadResult) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<DownloadResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('GalleryGrid downloads', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  it('announces loading, blocks duplicate clicks, and returns to idle after success', async () => {
    const user = userEvent.setup();
    const pending = deferredDownload();
    const service = jest.fn<ReturnType<PhotoDownloadService>, Parameters<PhotoDownloadService>>()
      .mockReturnValue(pending.promise);
    render(<GalleryGrid downloadService={service} />);
    const button = screen.getByRole('button', { name: 'Download Sunset Landscape' });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('svg')).toHaveClass('h-4', 'w-4', 'animate-spin');
    expect(button).toHaveAccessibleDescription('Downloading Sunset Landscape.');
    await user.click(button);
    expect(service).toHaveBeenCalledTimes(1);
    expect(service).toHaveBeenCalledWith(mockPhotos[0]);
    expect(screen.getByRole('button', { name: 'Download Portrait Study' })).toBeEnabled();
    await act(async () => pending.resolve({ filename: 'photo.jpg' }));
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-busy', 'false');
    expect(button.querySelector('svg')).not.toHaveClass('animate-spin');
    expect(button).toHaveAccessibleDescription('Download started for Sunset Landscape.');
    const status = document.getElementById(button.getAttribute('aria-describedby')!);
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('shows a visible, accessible error and allows retry', async () => {
    const user = userEvent.setup();
    const service = jest.fn()
      .mockRejectedValueOnce(new PhotoDownloadError('NETWORK'))
      .mockResolvedValue({ filename: 'photo.jpg' });
    render(<GalleryGrid downloadService={service} />);
    const button = screen.getByRole('button', { name: 'Download Sunset Landscape' });
    await user.click(button);
    const error = await screen.findByText('Unable to connect. Check your connection and try again.');
    expect(error).toBeVisible();
    expect(error).not.toHaveClass('sr-only');
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleDescription(error.textContent!);
    await user.click(button);
    expect(service).toHaveBeenCalledTimes(2);
    expect(button).toBeEnabled();
    expect(screen.queryByText('Unable to connect. Check your connection and try again.')).toBeNull();
  });

  it('does not expose raw adapter errors', async () => {
    const user = userEvent.setup();
    render(<GalleryGrid downloadService={jest.fn().mockRejectedValue(new Error('private token'))} />);
    await user.click(screen.getByRole('button', { name: 'Download Sunset Landscape' }));
    expect(await screen.findByText('The download could not be started. Please try again.')).toBeVisible();
    expect(screen.queryByText(/private token/)).toBeNull();
  });

  it('supports keyboard activation and independently downloading another photo', async () => {
    const user = userEvent.setup();
    const first = deferredDownload();
    const second = deferredDownload();
    const service = jest.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<GalleryGrid downloadService={service} />);
    // View details and like precede the download button in the tab order.
    await user.tab();
    await user.tab();
    await user.tab();
    const firstButton = screen.getByRole('button', { name: 'Download Sunset Landscape' });
    expect(firstButton).toHaveFocus();
    expect(firstButton.parentElement).toHaveClass('group-focus-within:opacity-100');
    await user.keyboard('{Enter}');
    const secondButton = screen.getByRole('button', { name: 'Download Portrait Study' });
    secondButton.focus();
    await user.keyboard(' ');
    expect(service).toHaveBeenCalledTimes(2);
    expect(firstButton).toBeDisabled();
    expect(secondButton).toBeDisabled();
    await act(async () => first.resolve({ filename: 'first.jpg' }));
    expect(firstButton).toBeEnabled();
    expect(secondButton).toBeDisabled();
    await act(async () => second.reject(new PhotoDownloadError('HTTP')));
    expect(secondButton).toBeEnabled();
  });

  it('preserves likes, details, filters, and pagination during a download', async () => {
    const user = userEvent.setup();
    const pending = deferredDownload();
    const service = jest.fn().mockReturnValue(pending.promise);
    const loadMore = jest.fn();
    const { rerender } = render(<GalleryGrid limit={1} onLoadMore={loadMore} downloadService={service} />);
    await user.click(screen.getByRole('button', { name: 'Download Sunset Landscape' }));
    const card = screen.getByRole('heading', { name: 'Sunset Landscape' }).closest('.card-elevated')!;
    const buttons = within(card as HTMLElement).getAllByRole('button');
    await user.click(buttons[1]);
    expect(within(card as HTMLElement).getByText('125')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View Details' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Sunset Landscape' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '✕' }));
    await user.click(screen.getByRole('button', { name: 'Load More Photos' }));
    expect(loadMore).toHaveBeenCalledTimes(1);
    rerender(<GalleryGrid currentPage={2} limit={1} downloadService={service} />);
    expect(screen.getByRole('heading', { name: 'Portrait Study' })).toBeInTheDocument();
    rerender(<GalleryGrid selectedTags={['portrait']} searchQuery="Jane" downloadService={service} />);
    expect(screen.queryByRole('heading', { name: 'Sunset Landscape' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Portrait Study' })).toBeInTheDocument();
    await act(async () => pending.resolve({ filename: 'photo.jpg' }));
  });
});
