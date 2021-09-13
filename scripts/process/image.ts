import * as path from 'path';
;
import imageminMozjpeg from 'imagemin-mozjpeg';
import imageminPngquant from 'imagemin-pngquant';
import imageminGifsicle from 'imagemin-gifsicle';
import imageminWebp from 'imagemin-webp';
import { getRemoteName, IFileDescriptor } from '../types';
import { HostingProvider } from '../providers';

export async function processImage(hosting: HostingProvider<unknown>, filePath: string, buffer: Buffer, onArtifact: (file: IFileDescriptor) => Promise<any>): Promise<void> {
  let contentSize = 0;
  const extname = path.posix.extname(filePath);
  switch (extname) {
    // Minify JPEGs and make progressive. Generate webp.
    case '.jpg':
    case '.jpeg':
      buffer = await imageminMozjpeg({ quality: 70 })(buffer);
      contentSize = Buffer.byteLength(buffer);
      await onArtifact(await generateWebp(hosting.domain, filePath, buffer));
      onArtifact({
        filePath,
        remoteName: getRemoteName(hosting.domain, filePath, buffer),
        buffer,
        contentType: 'image/jpeg',
        contentEncoding: undefined,
        cacheControl: 'public,max-age=31536000,immutable',
        contentSize,
      });
      break;

    // Minify PNGs. Generate webp.
    case '.png':
      buffer = await imageminPngquant({ quality: [.65, .80] })(buffer);
      contentSize = Buffer.byteLength(buffer);
      await onArtifact(await generateWebp(hosting.domain, filePath, buffer));
      onArtifact({
        filePath,
        remoteName: getRemoteName(hosting.domain, filePath, buffer),
        buffer,
        contentType: 'image/png',
        contentEncoding: undefined,
        cacheControl: 'public,max-age=31536000,immutable',
        contentSize,
      });
      break;

    // Minify GIFs.
    case '.gif':
      buffer = await imageminGifsicle({ optimizationLevel: 3 })(buffer);
      contentSize = Buffer.byteLength(buffer);
      onArtifact({
        filePath,
        remoteName: getRemoteName(hosting.domain, filePath, buffer),
        buffer,
        contentType: 'image/gif',
        contentEncoding: undefined,
        cacheControl: 'public,max-age=31536000,immutable',
        contentSize,
      });
      break;
    default: return;
  }
}

async function generateWebp(BUCKET: string, file: string, input: Buffer): Promise<IFileDescriptor> {
  const buffer = await imageminWebp({ quality: 75 })(input);
  let remoteName = path.posix.parse(path.posix.join(BUCKET, file));
  remoteName.ext = '.webp';
  const filePath = path.posix.format(remoteName);
  return {
    filePath,
    remoteName: getRemoteName(BUCKET, filePath, buffer),
    buffer,
    contentType: 'image/webp',
    contentEncoding: undefined,
    cacheControl: 'public,max-age=31536000,immutable',
    contentSize: Buffer.byteLength(buffer),
  };
}
