'use client';

import { useRef, useState } from 'react';
import {
  DownloadAsset,
  downloadPhoto,
  PhotoDownloadError,
  PhotoDownloadService,
} from '@/lib/photo-download';

export type PhotoDownloadState =
  | { status: 'downloading' }
  | { status: 'success' }
  | { status: 'error'; message: string };

export function usePhotoDownloads(service: PhotoDownloadService = downloadPhoto) {
  const [downloads, setDownloads] = useState<Record<string, PhotoDownloadState>>({});
  const inFlight = useRef(new Set<string>());

  const startDownload = async (photo: DownloadAsset) => {
    if (inFlight.current.has(photo.id)) return;
    inFlight.current.add(photo.id);
    setDownloads(previous => ({ ...previous, [photo.id]: { status: 'downloading' } }));
    try {
      await service(photo);
      setDownloads(previous => ({ ...previous, [photo.id]: { status: 'success' } }));
    } catch (error) {
      const message = error instanceof PhotoDownloadError
        ? error.message
        : 'The download could not be started. Please try again.';
      setDownloads(previous => ({ ...previous, [photo.id]: { status: 'error', message } }));
    } finally {
      inFlight.current.delete(photo.id);
    }
  };

  return { downloads, startDownload };
}
