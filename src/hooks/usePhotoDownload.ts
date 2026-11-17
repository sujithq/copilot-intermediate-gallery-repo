'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PhotoDownloadError,
  photoDownloadService,
  type PhotoDownloadRequest,
  type PhotoDownloadService,
} from '@/lib/photo-download';

export type PhotoDownloadState =
  | { status: 'idle' | 'loading'; message: string }
  | { status: 'error'; message: string; error: PhotoDownloadError };

export function usePhotoDownload(service: PhotoDownloadService = photoDownloadService) {
  const [states, setStates] = useState<Record<string, PhotoDownloadState>>({});
  const inFlight = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const requests = inFlight.current;
    return () => {
      requests.forEach(controller => controller.abort());
      requests.clear();
    };
  }, []);

  const download = useCallback(async (photo: PhotoDownloadRequest): Promise<void> => {
    if (inFlight.current.has(photo.id)) return;
    const controller = new AbortController();
    inFlight.current.set(photo.id, controller);
    setStates(previous => ({
      ...previous,
      [photo.id]: { status: 'loading', message: `Downloading ${photo.title}.` },
    }));

    try {
      await service.download(photo, controller.signal);
      if (!controller.signal.aborted) {
        setStates(previous => ({
          ...previous,
          [photo.id]: { status: 'idle', message: `Download started for ${photo.title}.` },
        }));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const failure = error instanceof PhotoDownloadError ? error : new PhotoDownloadError('browser');
        setStates(previous => ({
          ...previous,
          [photo.id]: failure.code === 'aborted'
            ? { status: 'idle', message: failure.message }
            : { status: 'error', message: failure.message, error: failure },
        }));
      }
    } finally {
      if (inFlight.current.get(photo.id) === controller) {
        inFlight.current.delete(photo.id);
      }
    }
  }, [service]);

  return { states, download };
}
