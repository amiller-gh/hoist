export interface IAuth {
  clientEmail: string;
  privateKey: string;
  projectId: string;
}

export interface GoogleBucketObject {
  kind: string;
  id: string;
  selfLink: string;
  name: string;
  bucket: string;
  generation: string;
  metageneration: string;
  contentType: string;
  timeCreated: string;
  updated: string;
  storageClass: string;
  timeStorageClassUpdated: string;
  size: string;
  md5Hash: string;
  mediaLink: string;
  crc32c: string;
  etag: string;
}

export interface BucketObject {
  delete(options?: { type: 'file' | 'folder' }): Promise<{count: number; timeout: number; }>;
}

export interface GoogleCloudBucket {
  addPublicAccess(): Promise<void>;
  removePublicAccess(): Promise<void>;
  object(name: string): Promise<BucketObject>;
  create(opts: { location: string }): GoogleCloudBucket;
  cors: any;
  website: any;
}

export interface IGoogleCloudOptions {
  timeout: number;
  headers?: any;
}

export interface GoogleCloudClient {
  exists(name: string): GoogleCloudClient;
  bucket(bucketName: string): GoogleCloudBucket;
  create(): Client;
  get<T extends any>(name: string, options?: IGoogleCloudOptions): Promise<T>;
  list(name: string, options?: IGoogleCloudOptions): Promise<GoogleBucketObject[]>;
  insert(content: Buffer, name: string, options?: IGoogleCloudOptions): Promise<GoogleBucketObject>;
}

export const client = {
  new: (auth: IAuth) => GoogleCloudClient
};

