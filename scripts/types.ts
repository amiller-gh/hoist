import * as path from 'path';

import { cdnFileName } from "./fileHash";
import { HostingProvider } from "./providers";

export interface ISourceFile {
  path: string;
  hash: string;
  buffer: Buffer;
}

export interface IFileDescriptor {
  filePath: string;
  remoteName: string;
  buffer: Buffer;
  contentType: string;
  contentEncoding: string | undefined;
  cacheControl: string;
  contentSize: number;
}

export interface IHoistServer {
  toDelete: Record<string, number>;
  fileCache: Set<string>;
}

export type FileHandler = (hosting: HostingProvider<unknown>, fileName: string, buffer: Buffer, onArtifact: (file: IFileDescriptor) => Promise<any>) => Promise<void>;

export const HOIST_PRESERVE = '.hoist-preserve';
export const DELETE_FILENAME = '.hoist-delete';
export const CACHE_FILENAME = '.hoist-cache';
export const CONFIG_FILENAME = 'gcloud.json';
export const SYSTEM_FILES = new Set([DELETE_FILENAME, CACHE_FILENAME, CONFIG_FILENAME, HOIST_PRESERVE]);

export function getRemoteName(BUCKET: string, file: string, buffer: Buffer): string {
  let remoteName = path.posix.parse(path.posix.join(BUCKET, file));
  remoteName.base = cdnFileName(buffer);
  remoteName.ext = '';
  return path.posix.format(remoteName);
}
