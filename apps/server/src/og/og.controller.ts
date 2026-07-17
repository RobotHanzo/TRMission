import { Controller, Get, Header, Param, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { OgService } from './og.service';
import { env } from '../config/env';

// Unauthenticated by design: crawlers cannot log in. What each endpoint may reveal is
// decided in OgService (room code = join capability; replays only when view-by-link).
// nginx rewrites bot requests for /, /room/* and /replay/* to GET /api/v1/og/page.
const CACHE = 'public, max-age=300';

/** Public origin for absolute og:image/og:url values — nginx forwards proto + host. */
function baseUrl(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host;
  if (!host) return env.oauthRedirectBase;
  return `${proto ?? req.protocol ?? 'http'}://${host}`;
}

@ApiExcludeController()
@Controller('api/v1/og')
export class OgController {
  constructor(private readonly og: OgService) {}

  @Get('page')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', CACHE)
  async page(
    @Query('path') path: string | undefined,
    @Query('code') code: string | undefined,
    @Req() req: Request,
  ): Promise<string> {
    return this.og.pageHtml(await this.og.pageMeta(path, code), baseUrl(req));
  }

  // nginx rewrites the site-root /robots.txt and /sitemap.xml here (the Vite dev proxy
  // mirrors that) — absolute URLs need the request host, never known at build time.
  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', CACHE)
  robots(@Req() req: Request): string {
    return this.og.robotsTxt(baseUrl(req));
  }

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', CACHE)
  sitemap(@Req() req: Request): string {
    return this.og.sitemapXml(baseUrl(req));
  }

  @Get('site.png')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', CACHE)
  site(): StreamableFile {
    return new StreamableFile(this.og.sitePng());
  }

  @Get('room/:code.png')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', CACHE)
  async room(@Param('code') code: string): Promise<StreamableFile> {
    return new StreamableFile(await this.og.roomPng(code));
  }

  @Get('replay/:gameId.png')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', CACHE)
  async replay(@Param('gameId') gameId: string): Promise<StreamableFile> {
    return new StreamableFile(await this.og.replayPng(gameId));
  }

  @Get('map/:code.png')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', CACHE)
  async map(@Param('code') code: string): Promise<StreamableFile> {
    return new StreamableFile(await this.og.mapPng(code));
  }
}
