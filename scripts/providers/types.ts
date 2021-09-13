import { ISourceFile } from "../types";

export interface FileDescriptor {
  name: string;
  createdAt: Date;
  updatedAt: Date;
  contentType: string;
  contentEncoding: string | undefined;
  cacheControl: string | undefined;
  contentSize: number;
  md5Hash: string;
  etag: string;
}

export interface IHeaders {
  'Content-Type'?: string;
  'Content-Encoding'?: string;
  'Cache-Control'?: string;
  'x-content-size'?: number;
};

export abstract class HostingProvider<AuthObject extends any> {
  public readonly domain: string;
  protected auth: AuthObject;

  public files: Record<string, ISourceFile> = {};
  public toDelete: Record<string, number> = {};
  public fileCache: Set<string> = new Set();

  constructor(domain: string, auth: AuthObject) { this.domain = domain; this.auth = auth; };

  abstract init(): Promise<this>;
  abstract makePublic(): Promise<void>;
  abstract makePrivate(): Promise<void>;
  abstract get<T extends any>(name: string): Promise<T>;
  abstract list(name: string): Promise<FileDescriptor[]>;
  abstract delete(name: string): Promise<boolean>;
  abstract upload(content: Buffer, name: string, options: IHeaders): Promise<FileDescriptor>;
}