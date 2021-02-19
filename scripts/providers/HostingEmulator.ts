import * as fs from 'fs-extra';
import * as path from 'path';
import tmp from 'tmp';
import globSync from 'glob';
import { promisify } from 'util';
import mime from 'mime-types';

import { IConfig } from '../getConfig';
import { fileHash } from '../fileHash';
import { FileDescriptor, HostingProvider, IHeaders } from './types';
import { serve, HoistServer } from '../serve';

const glob = promisify(globSync);

export class HostingEmulator extends HostingProvider<IConfig> {
  private dir: tmp.DirResult = tmp.dirSync({ keep: false, unsafeCleanup: true, prefix: 'hoist' });
  private server: HoistServer | null = null;
  async init() {
    fs.mkdirSync(path.join(this.dir.name, process.env.HOIST_EMULATE || ''), { recursive: true })
    this.server = await serve(path.join(this.dir.name, process.env.HOIST_EMULATE || ''), '443', false);
    return this;
  }
  async makePublic() { this.server?.makePublic(); return; }
  async makePrivate() { this.server?.makePrivate(); return; }
  async get<T extends any>(name: string) {
    const paths = await glob(path.join(this.dir.name, name, '*'))
    if (paths.length === 0) { throw new Error('File Not Found.'); }
    const data = fs.readFileSync(paths[0]);
    try {
      return JSON.parse(data.toString()) as T;
    } catch {
      return data as T;
    }
  }
  async list(name: string): Promise<FileDescriptor[]> {
    const out: FileDescriptor[] = [];
    for (let filePath of await glob(path.join(this.dir.name, name, '**', '*'))) {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) { continue; }
      let contentEncoding: undefined | 'gzip' | 'brotli' = undefined;
      if (filePath.endsWith('.gz')) {
        contentEncoding = 'gzip';
        filePath = filePath.slice(0, -3);
      }
      if (filePath.endsWith('.br')) {
        contentEncoding = 'brotli';
        filePath = filePath.slice(0, -3);
      }
      const parsedPath = path.parse(filePath);
      parsedPath.base = parsedPath.base.slice(0, parsedPath.ext.length * -1);
      parsedPath.ext = '';
      const hash = fileHash(filePath);
      out.push({
        name: path.format(parsedPath),
        createdAt: stat.ctime,
        updatedAt: stat.mtime,
        contentType: mime.lookup(filePath) || 'application/octet-stream',
        contentEncoding,
        cacheControl: '',
        contentSize: stat.size,
        md5Hash: hash,
        etag: hash,
      });
    }
    return out;
  }
  async delete(name: string) {
    fs.rmSync(path.join(this.dir.name, name), { recursive: true });
    return true;
  }
  async upload(content: Buffer, name: string, options: IHeaders): Promise<FileDescriptor> {
    const contentType = options["Content-Type"] || 'application/octet-stream';
    const contentEncoding = options["Content-Encoding"];
    const ext = mime.extension(contentType);
    if (ext && !name.endsWith(ext)) { name += `.${ext}`; }
    if (contentEncoding === 'gzip') { name += '.gz'; }
    if (contentEncoding === 'brotli') { name += '.br'; }
    const filePath = path.join(this.dir.name, name);
    const hash = fileHash(content);
    fs.outputFileSync(filePath, content);
    const stat = fs.statSync(filePath);
    const desc = {
      name,
      createdAt: stat.ctime,
      updatedAt: stat.mtime,
      contentType,
      contentEncoding,
      cacheControl: options['Cache-Control'],
      contentSize: stat.size,
      md5Hash: hash,
      etag: hash,
    };
    return desc;
  }
}
