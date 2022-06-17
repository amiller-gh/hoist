import * as fs from 'fs';
import * as path from 'path';
import findUp from 'find-up';
import { gzip } from 'node-gzip';
import { promisify } from 'util';
import globSync from 'glob';
import replace from 'buffer-replace';
import sharp from 'sharp';
import postcss from 'postcss';
import cssnano from 'cssnano';
import autoprefixer from 'autoprefixer';
import Terser from 'terser';
import htmlMinifier from 'html-minifier';
import mime from 'mime-types';
import mimeDb from 'mime-db';

import initBucket from './initBucket'
import { cdnFileName, hoistCacheName } from './fileHash';
import Processor from 'postcss/lib/processor';
import type { IHeaders } from './providers/types';
import { getConfig } from './getConfig';

const HOIST_PRESERVE = '.hoist-preserve';
const DELETE_FILENAME = '.hoist-delete';
const CACHE_FILENAME = '.hoist-cache';
const CONFIG_FILENAME = 'gcloud.json';
const SYSTEM_FILES = new Set([DELETE_FILENAME, CACHE_FILENAME, CONFIG_FILENAME, HOIST_PRESERVE]);

const glob = promisify(globSync);

interface IFileDescriptor {
  filePath: string;
  remoteName: string;
  buffer: Buffer;
  contentType: string;
  contentEncoding: string | undefined;
  cacheControl: string;
  contentSize: number;
}

const WELL_KNOWN = {
  'favicon.ico': true,
  'robots.txt': true,
  'index.html': true,
  '.well-known': true,
}

let preserve = {};

async function generateWebp(file: string, input: Buffer, BUCKET: string, root: string) {
  let remoteName = path.posix.parse(path.posix.join(BUCKET, file));
  const shouldRewrite = await shouldRewriteUrl(root, path.posix.parse(file));
  remoteName.ext = '.webp';
  const filePath = path.posix.format(remoteName)
  const buffer = await sharp(input).webp().toBuffer();
  if (shouldRewrite) {
    remoteName.base = cdnFileName(buffer);
    remoteName.ext = '';
  }
  return {
    filePath,
    remoteName: path.posix.format(remoteName),
    buffer,
    contentType: 'image/webp',
    contentEncoding: undefined,
    cacheControl: 'public,max-age=31536000,immutable',
    contentSize: Buffer.byteLength(buffer),
  };
}

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

async function shouldRewriteUrl(root: string, remoteName: path.FormatInputPathObject): Promise<boolean> {
  const config = await getConfig(root);
  if (config.contentHash === false) { return false; }
  const filePath = path.posix.join(root, path.posix.format(remoteName));
  return !WELL_KNOWN[remoteName.base || ''] && !preserve[filePath] && filePath.indexOf('.well-known') !== 0 && remoteName.ext !== '.json';
}

export interface Logger {
  info: (...args: any) => void;
  error: (...args: any) => void;
  warn: (...args: any) => void;
  progress: (status: { value: number; total: number; }) => void;
}

export async function deploy(root: string, directory = '', userBucket: string | null = null, log: Partial<Logger> | null = null) {
  const preserveFile = await findUp(HOIST_PRESERVE, { cwd: root }) || '';
  const config = await getConfig(root);
  const BUCKET = (process.env.HOIST_EMULATE ? config.bucket : (userBucket || config.bucket)).toLowerCase();
  const hosting = await initBucket(config, BUCKET)

  let fileCache = new Set();
  try { fileCache = new Set(await hosting.get<string[]>(path.posix.join(BUCKET, CACHE_FILENAME))); } catch {}
  fileCache = fileCache && fileCache.size ? fileCache : new Set();

  let iter = 0;
  const THREAD_COUNT = 12;
  const threads: Promise<void>[] = [];
  for (let i=0;i<THREAD_COUNT;i++) { threads.push(Promise.resolve()); }

  const hashes: Record<string, string> = {};
  const buffers: Record<string, Buffer> = {};
  try {
    let globs: string[] = [];
    try { globs = fs.readFileSync(preserveFile, 'utf8').split(/\r\n|\r|\n/g) } catch(_) {};
    for (let globPath of globs) {
      const cwd = path.resolve(preserveFile, '..');
      for (let filePath of await glob(globPath, { cwd } )) {
        if (fs.statSync(path.join(cwd, filePath)).isDirectory()) { continue; }
        preserve[path.join(cwd, filePath)] = true;
      }
    }
  } catch(_err) {
    log?.error?.(_err)
    preserve = {};
  }

  // Fetch all our file buffers and content hashes, excluding Hoist system files.
  // Use platform specific separator for filesystem access.
  // We normalize this to posix paths for web below.
  for (let filePath of await glob(path.join(root, directory, '**', '*'))) {
    if (fs.statSync(filePath).isDirectory()) { continue; }
    if (SYSTEM_FILES.has(path.basename(filePath))) { continue; }
    // Normalize the path on windows for web use.
    const posixPath = path.posix.join(...filePath.split(path.sep));
    const posixRoot = path.posix.join(...root.split(path.sep));
    let file = path.posix.relative(posixRoot, posixPath);
    buffers[file] = fs.readFileSync(filePath);
    if (await shouldRewriteUrl(root, path.parse(file))) {
      hashes[file] = cdnFileName(buffers[file]);
    }
  }

  let noopCount = 0;
  let uploadCount = 0;
  let errorCount = 0;
  async function upload({ remoteName, buffer, contentType, contentEncoding, cacheControl, contentSize }: IFileDescriptor) {
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

    // Do nothing if the file is already on the server, in the correct location, and unchanged.
    if (fileCache.has(hash)) {
      noopCount++;
      log?.progress?.({ value: uploadCount + errorCount + noopCount, total: entries.length })
      return;
    }
    fileCache.add(hash);

    // Upload it!
    await hosting.upload(buffer, remoteName, headers).then(() => {
      uploadCount++;
      log?.progress?.({ value: uploadCount + errorCount + noopCount, total: entries.length })
    }, (err: Error) => {
      log?.error?.(err.message);
      errorCount++;
    });
  }

  const entries = Object.entries(buffers);
  await new Promise<void>((resolve) => {
    const oldNames = Object.keys(hashes).sort((a, b) => a.length > b.length ? -1 : 1);
    log?.progress?.({ value: uploadCount + errorCount + noopCount, total: entries.length })

    // If nothing to upload, exit early.
    if (entries.length === 0) { return resolve(); }

    for (let [filePath, buffer] of entries) {
      const hash = hashes[filePath];
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
            if (remoteName.name !== 'index') {
              remoteName.base = remoteName.name;
              remoteName.ext = '';
            }

            // Minify HTML
            buffer = Buffer.from(htmlMinifier.minify(buffer.toString(), {
              caseSensitive: true,
              collapseBooleanAttributes: true,
              collapseInlineTagWhitespace: false,
              continueOnParseError: true,
              collapseWhitespace: true,
              decodeEntities: true,
              minifyCSS: true,
              minifyJS: true,
              quoteCharacter: `"`,
              removeAttributeQuotes: true,
              removeComments: true,
              removeScriptTypeAttributes: true,
              removeStyleLinkTypeAttributes: true,
              sortAttributes: true,
              sortClassName: true,
              useShortDoctype: true,
            }));
          }

          // Otherwise, if not a well known file, use the hash value as its name for CDN cache busting.
          else if (await shouldRewriteUrl(root, remoteName)) {
            remoteName.base = hash;
            remoteName.ext = '';
          }

          // If we're not rewriting this URL to a hash, we need the cache to revalidate every time.
          else {
            cacheControl = 'public,max-age=0';
          }

          // Replace all Hash names in CSS and HTML files.
          if (extname === '.css' || extname === '.html') {
            for (let oldName of oldNames) {
              let hashNameObj = path.posix.parse(oldName);
              if (oldName.endsWith('.html') || oldName.endsWith('.json')) { continue; }
              const hash = hashes[oldName];
              hashNameObj.base = hash;
              hashNameObj.ext = '';
              let hashName = path.posix.format(hashNameObj);
              buffer = replace(buffer, `/${oldName}`, `/${hashName}`);
              buffer = replace(buffer, `(${oldName})`, `(/${hashName})`);
              const relativePath = path.posix.relative(path.posix.dirname(filePath), oldName);
              if (relativePath) {
                if (!relativePath.startsWith('.')) {
                  buffer = replace(buffer, `./${relativePath}`, `/${hashName}`);
                  buffer = replace(buffer, `/${relativePath}`, `/${hashName}`);
                  buffer = replace(buffer, `(${relativePath})`, `(/${hashName})`);
                }
                else {
                  buffer = replace(buffer, relativePath, `/${hashName}`);
                }
              }
            }
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
            entries.push([sourceMap.filePath, sourceMap.buffer])
            await upload(sourceMap);
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
              entries.push([sourceMap.filePath, sourceMap.buffer])
              await upload(sourceMap);
            }
          }

          // If is an image, minify it.
          // If not an image, we gzip it.
          let webp;
          let contentSize = 0;
          switch (extname) {
            // Minify JPEGs and make progressive. Generate webp.
            case '.jpg':
            case '.jpeg':
              buffer = await sharp(buffer).rotate().jpeg({ mozjpeg: true, quality: 70, progressive: true }).toBuffer();
              contentSize = Buffer.byteLength(buffer);
              webp = await generateWebp(filePath, buffer, BUCKET, root);
              entries.push([webp.filePath, webp.buffer]);
              await upload(webp);
              break;

            // Minify PNGs. Generate webp.
            case '.png':
              buffer = await sharp(buffer).png({ progressive: true, compressionLevel: 7 }).toBuffer();
              contentSize = Buffer.byteLength(buffer);
              webp = await generateWebp(filePath, buffer, BUCKET, root);
              entries.push([webp.filePath, webp.buffer]);
              await upload(webp);
              break;

            // Minify GIFs.
            case '.gif':
              // TODO: Minify GIFs
              contentSize = Buffer.byteLength(buffer);
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
          await upload({
            filePath,
            remoteName: path.posix.join(BUCKET, path.posix.format(remoteName)),
            buffer,
            contentType,
            contentEncoding,
            cacheControl,
            contentSize,
          });

        } catch(err) {
          log?.error?.(err);
        }

        // If this is the last to process, resolve.
        if ((uploadCount + errorCount + noopCount) === entries.length) { resolve(); }
      });
      iter++;
    }
  });

  log?.progress?.({ value: entries.length, total: entries.length })
  log?.info?.(`✅ ${uploadCount} items uploaded.`);
  log?.info?.(`⏺  ${noopCount} items already present.`);
  log?.info?.(`❗ ${errorCount} items failed.`);

  const fileCacheBuffer = Buffer.from(JSON.stringify([...fileCache], null, 2));
  await upload({
    buffer: await gzip(fileCacheBuffer, { level: 8 }),
    filePath: CACHE_FILENAME,
    remoteName: path.posix.join(BUCKET, CACHE_FILENAME),
    contentType: 'application/json',
    contentEncoding: 'gzip',
    cacheControl: 'no-cache,no-store,max-age=0',
    contentSize: Buffer.byteLength(fileCacheBuffer),
  });

  // Return the URL where we just uploaded everything to.
  return `https://${BUCKET}`;
}
