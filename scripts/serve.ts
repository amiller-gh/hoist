#!/usr/bin/env node
import * as https from 'https';
import * as path from 'path';

import * as devcert from 'devcert';
import express from 'express';
import { createHttpTerminator } from 'http-terminator';
import open from 'open';
import getPort from 'get-port';
import mime from 'mime-types';

import { getConfig } from './getConfig';

export interface HoistServer {
  port: number;
  url: string;
  root: string;
  isPublic(bool: boolean): boolean;
  stop(): Promise<void>;
}

function setHeaders(res: express.Response, file: string) {
  if (file.endsWith('.br')) {
    res.setHeader('Content-Encoding', 'brotli');
    var type = mime.lookup(file.slice(0, -3));
    var charset = type && mime.charset(type);
    res.setHeader("Content-Type", type + (charset ? "; charset=" + charset : ""));
  }
  if (file.endsWith('.gz')) {
    res.setHeader('Content-Encoding', 'gzip');
    var type = mime.lookup(file.slice(0, -3));
    var charset = type && mime.charset(type);
    res.setHeader("Content-Type", type + (charset ? "; charset=" + charset : ""));
  }
}

export async function serve(root: string, usrPort: string | null = null, autoOpen=true): Promise<HoistServer> {
  console.log('SERVING', root, usrPort);
  const app = express();
  const settings = await getConfig(root);

  let isPublic = true;
  app.use((req, res, next) => {
    if (!isPublic) {
      res.status(401).json({ status: 'error', code: 401, message: 'Unauthorized.'});
      return;
    }

    // Adjust for the current subdomain emulated.
    if (process.env.HOIST_EMULATE) {
      req.originalUrl = path.join(process.env.HOIST_EMULATE, req.originalUrl);
      req.url = path.join(process.env.HOIST_EMULATE, req.url);
    }

    next();
  });

  app.use(express.static(root, {
    setHeaders,
    extensions: [
      // Text Based Files
      // Check for local GZip and Brotli versions of these.
      'html.br', 'htm.br', 'css.br', 'js.br', 'json.br', 'svg.br', 'md.br', 'txt.br',
      'html.gz', 'htm.gz', 'css.gz', 'js.gz', 'json.gz', 'svg.gz', 'md.gz', 'txt.gz',
      'html', 'htm', 'css', 'js', 'json', 'svg', 'md', 'txt',

      // Font Formats
      // Check for local GZip and Brotli versions of these.
      'woff.br', 'woff2.br', 'eot.br', 'ttf.br', 'otf.br',
      'woff.gz', 'woff2.gz', 'eot.gz', 'ttf.gz', 'otf.gz',
      'woff', 'woff2', 'eot', 'ttf', 'otf',

      // Binary Files. These will not be compressed so no need to check.
      'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'bin'
    ],
  }));

  // Try Local GZip Files. Express.static will not try fallback extensions if a valid extension is present, so we force it to try.
  app.use((req, _, next) => { req.originalUrl += '.gz'; req.url += '.gz'; next(); });
  app.use(express.static(root, { setHeaders }));

  // Try Local Brotli Files. Express.static will not try fallback extensions if a valid extension is present, so we force it to try.
  app.use((req, _, next) => { req.originalUrl = req.originalUrl.slice(0, -3) + '.br'; req.url = req.url.slice(0, -3) + '.br'; next(); });
  app.use(express.static(root, { setHeaders }));

  // For logging purposes, set the request url back to normal if we didn't find anything.
  app.use((req, _, next) => { req.originalUrl = req.originalUrl.slice(0, -3); req.url = req.url.slice(0, -3); next(); });
  const domain = settings.testDomain || settings['test_domain'] || 'hoist.test';

  if (!devcert.hasCertificateFor(domain)){
    console.log('Installing SSL Cert, This May Take a Moment');
  }

  const ssl = await devcert.certificateFor(domain);
  const port = await getPort({ port: usrPort ? parseInt(usrPort) : 443 });
  const url = `https://${domain}${port === 443 ? '' : `:${port}`}`;
  const server = https.createServer(ssl, app).listen(port, () => console.log(`Static site serving on port ${port}!`));
  const terminator = createHttpTerminator({ server });

  if (autoOpen) {
    await open(`${url}${typeof autoOpen === 'string' ? autoOpen : ''}`);
  }

  return {
    url,
    port,
    root,
    isPublic: (bool: boolean) => isPublic = bool,
    stop: () => terminator.terminate(),
  };
}
