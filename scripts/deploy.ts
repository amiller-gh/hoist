import * as fs from 'fs';
import * as path from 'path';
import findUp from 'find-up';
import { gzip } from 'node-gzip';
import { promisify } from 'util';
import globSync from 'glob';
import postcss from 'postcss';
import cssnano from 'cssnano';
import autoprefixer from 'autoprefixer';
import Terser from 'terser';
import cliProgress from 'cli-progress';
import mime from 'mime-types';
import mimeDb from 'mime-db';

import initBucket from './initBucket'
import { cdnFileName, hoistCacheName, shouldRewriteUrl } from './fileHash';
import Processor from 'postcss/lib/processor';
import type { HostingProvider, IHeaders } from './providers/types';
import { getConfig } from './getConfig';
import { IFileDescriptor, ISourceFile, HOIST_PRESERVE, CACHE_FILENAME, DELETE_FILENAME, SYSTEM_FILES, FileHandler } from './types';
import { processImage } from './process/image';
import { processHtml } from './process/html';

const handlers: FileHandler[] = [
  processImage,
  processHtml,
]

const glob = promisify(globSync);

const progress = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
let preserve = {};


function generateSourceMapFile(filePath: string, remoteName: string, content: Buffer | string, BUCKET: string): IFileDescriptor {
  remoteName = path.posix.join(BUCKET, remoteName) + '.map';
  const buffer = Buffer.from(content);
  return {
    filePath,
    remoteName,
    buffer,
    contentType: 'application/json',
    contentEncoding: undefined,
    cacheControl: 'public,max-age=31536000,immutable',
    contentSize: Buffer.byteLength(buffer),
  };
}

export interface Logger {
  log: (...args: any) => void;
  error: (...args: any) => void;
  warn: (...args: any) => void;
}

enum UploadStatus {
  NOOP,
  SUCCESS,
  ERROR,
}

async function upload(hosting: HostingProvider<any>, { remoteName, buffer, contentType, contentEncoding, cacheControl, contentSize }: IFileDescriptor, log: Logger, isCli = false) {
  const headers: IHeaders = {
    'Content-Type': contentType,
    'Content-Encoding': contentEncoding,
    'Cache-Control': cacheControl,
    'x-content-size': contentSize || 0,
  };

  if (!headers['Content-Type']) { delete headers['Content-Type']; }
  if (!headers['Content-Encoding']) { delete headers['Content-Encoding']; }
  if (!headers['Cache-Control']) { delete headers['Cache-Control']; }

  const hash = hoistCacheName(remoteName, buffer);

  // Remove this item from our remote objects map so we don't delete if we cleanup.
  delete hosting.toDelete[hash];

  // Do nothing if the file is already on the server, in the correct location, and unchanged.
  if (hosting.fileCache.has(hash)) {
    isCli && progress.increment(1);
    return UploadStatus.NOOP;
  }
  hosting.fileCache.add(hash);

  // Upload it!
  await hosting.upload(buffer, remoteName, headers).then(() => {
    isCli && progress.increment(1);
    return UploadStatus.SUCCESS;
  }, (err: Error) => {
    log.error(err.message);
    isCli && progress.increment(1);
    return UploadStatus.ERROR
  });
}

export async function deploy(root: string, directory = '', userBucket: string | null = null, logger: Logger | boolean = false, autoDelete = false) {
  const NOW = Date.now();
  const preserveFile = await findUp(HOIST_PRESERVE, { cwd: root }) || '';
  const config = await getConfig(root);
  const BUCKET = (process.env.HOIST_EMULATE ? config.bucket : (userBucket || config.bucket)).toLowerCase();
  const log = typeof logger !== 'boolean' ? logger : console;
  const isCli = logger === true;
  const hosting = await initBucket(config, directory, BUCKET)

  let iter = 0;
  const THREAD_COUNT = 12;
  const threads: Promise<void>[] = [];
  for (let i=0;i<THREAD_COUNT;i++) { threads.push(Promise.resolve()); }

  const files: Record<string, ISourceFile> = {};
  try {
    let globs: string[] = [];
    try { globs = fs.readFileSync(preserveFile, 'utf8').split(/\r\n|\r|\n/g) } catch(_) {};
    for (let globPath of globs) {
      const cwd = path.resolve(preserveFile, '..');
      for (let filePath of await glob(globPath, { cwd } )) {
        console.log(globPath, cwd, path.join(cwd, filePath));
        if (fs.statSync(path.join(cwd, filePath)).isDirectory()) { continue; }
        preserve[path.join(cwd, filePath)] = true;
      }
    }
  } catch(_err) {
    log.error(_err)
    preserve = {};
  }

  const posixRoot = path.posix.join(...root.split(path.sep));

  // Fetch all our file buffers and content hashes, excluding Hoist system files.
  // Use platform specific separator for filesystem access.
  // We normalize this to posix paths for web below.
  for (let filePath of await glob(path.join(root, directory, '**', '*'))) {
    if (fs.statSync(filePath).isDirectory()) { continue; }
    if (SYSTEM_FILES.has(path.basename(filePath))) { continue; }

    // Normalize the path on windows for web use.
    const posixPath = path.posix.join(...filePath.split(path.sep));
    let file = path.posix.relative(posixRoot, posixPath);
    const buffer = fs.readFileSync(filePath);
    files[file] = {
      path: file,
      buffer,
      hash: cdnFileName(buffer),
    };
  }

  let noopCount = 0;
  let uploadCount = 0;
  let errorCount = 0;

  await new Promise<void>((resolve) => {
    isCli && progress.start(Object.keys(files).length, uploadCount + errorCount);

    for (let desc of Object.values(files)) {
      const filePath = desc.path;
      let buffer = desc.buffer;
      const hash = files[filePath]?.hash;
      const extname = path.posix.extname(filePath);
      const contentType = mime.contentType(extname) || 'application/octet-stream';
      const compress = mimeDb[contentType]?.compressible || false;
      let contentEncoding: string | undefined = undefined;
      let cacheControl = 'public,max-age=31536000,immutable';

      threads[iter % THREAD_COUNT] = threads[iter % THREAD_COUNT].then(async () => {
        try {
          let remoteName = path.posix.parse(filePath);

          if (remoteName.ext === '.html') {
            // Never cache HTML files.
            cacheControl = 'public,max-age=0';

            // If an HTML file, but not the index.html, remove the `.html` for a bare URLs look in the browser.
            if (shouldRewriteUrl(root, remoteName, preserve)) {
              remoteName.base = remoteName.name;
              remoteName.ext = '';
            }

            // Minify HTML
            await processHtml(hosting, filePath, buffer, (file) => upload(hosting, file, log, isCli));
          }

          // Otherwise, if not a well known file, use the hash value as its name for CDN cache busting.
          else if (shouldRewriteUrl(root, remoteName, preserve)) {
            remoteName.base = hash;
            remoteName.ext = '';
          }

          // If we're not rewriting this URL to a hash, we need the cache to revalidate every time.
          else {
            cacheControl = 'public,max-age=0';
          }

          // Minify and upload sourcemaps for CSS resources.
          if (extname === '.css') {
            const bareRemoteName = path.posix.format(remoteName);
            const res = await postcss([autoprefixer, cssnano] as unknown as Processor[]).process(buffer, {
              from: filePath,
              to: bareRemoteName,
              map: { inline: false },
            });
            const sourceMap = generateSourceMapFile(filePath, bareRemoteName, res.map.toString(), BUCKET);
            await upload(hosting, sourceMap, log, isCli);
            buffer = Buffer.from(res.css);
          }

          // Minify and upload sourcemaps for JS resources. Avoid minifying already minified files.
          if (extname === '.js' && !filePath.includes('.min.js')) {
            const bareRemoteName = path.posix.format(remoteName);
            const res = await Terser.minify(buffer.toString(), {
              toplevel: true,
              ecma: 2017,
              sourceMap: {
                filename: filePath,
                url: `/${bareRemoteName}.map`,
              }
            });

            buffer = res.code ? Buffer.from(res.code) : buffer;

            if (res.map) {
              const sourceMap = generateSourceMapFile(filePath, bareRemoteName, res.map as string, BUCKET);
              await upload(hosting, sourceMap, log, isCli);
            }
          }

          // If is an image, minify it.
          // If not an image, we gzip it.
          let contentSize = 0;
          switch (extname) {
            // Minify JPEGs and make progressive. Generate webp.
            // Minify PNGs. Generate webp.
            // Minify GIFs.
            case '.jpg':
            case '.jpeg':
            case '.png':
            case '.gif':
              await processImage(hosting, filePath, buffer, (file) => upload(hosting, file, log, isCli));
              break;

            // If it is compressible, gzip the world!
            // TODO: When brotli support is high enough, or when Google automatically
            // deflates if not supported, switch to brotli.
            default:
              contentSize = Buffer.byteLength(buffer);
              if (compress) {
                buffer = await gzip(buffer, { level: 8 });
                contentEncoding = 'gzip';
              }
              // buffer = await brotli.compress(buffer);
              // contentEncoding = 'br';
          }

          // We have successfully computed our remote name!
          await upload(hosting, {
            filePath,
            remoteName: path.posix.join(BUCKET, path.posix.format(remoteName)),
            buffer,
            contentType,
            contentEncoding,
            cacheControl,
            contentSize,
          }, log, isCli);

        } catch(err) {
          log.error(err);
        }

        // If this is the last to process, resolve.
      });
      iter++;
    }

    Promise.all(Object.values(threads)).then(() => resolve());
  });

  // If file has been marked for deletion over three days ago, remove it from the server.
  let deletedCount = 0;
  if (autoDelete) {
    for (let [name, deleteDate] of Object.entries(hosting.toDelete)) {
      if (deleteDate < (NOW - (1000 * 60 * 60 * 24 * 3))) {
        await hosting.delete(name);
        delete hosting.toDelete[name];
        deletedCount++;
      }
    }
  }

  isCli && progress.stop();
  log.log(`✅ ${uploadCount} items uploaded.`);
  log.log(`⏺  ${noopCount} items already present.`);
  log.log(`⌛ ${Object.keys(hosting.toDelete).length} items queued for deletion.`);
  log.log(`🚫 ${deletedCount} items deleted.`);
  log.log(`❗ ${errorCount} items failed.`);

  const fileCacheBuffer = Buffer.from(JSON.stringify([...hosting.fileCache], null, 2));
  await upload(hosting, {
    buffer: await gzip(fileCacheBuffer, { level: 8 }),
    filePath: CACHE_FILENAME,
    remoteName: path.posix.join(BUCKET, CACHE_FILENAME),
    contentType: 'application/json',
    contentEncoding: 'gzip',
    cacheControl: 'no-cache,no-store,max-age=0',
    contentSize: Buffer.byteLength(fileCacheBuffer),
  }, log, isCli);

  const toDeleteBuffer = Buffer.from(JSON.stringify(hosting.toDelete, null, 2));
  await upload(hosting, {
    buffer: await gzip(toDeleteBuffer, { level: 8 }),
    filePath: DELETE_FILENAME,
    remoteName: path.posix.join(BUCKET, DELETE_FILENAME),
    contentType: 'application/json',
    contentEncoding: 'gzip',
    cacheControl: 'no-cache,no-store,max-age=0',
    contentSize: Buffer.byteLength(toDeleteBuffer),
  }, log, isCli);

  // Return the URL where we just uploaded everything to.
  return `https://${BUCKET}`;

}
